# Database Indexes, Query Performance & Migration Safety (Phase 49)

This documents the current state of the MongoDB/Mongoose data layer after a full audit: what
indexes exist and why, how indexes are safely created/changed going forward, and what was
deliberately left alone because the evidence didn't justify a change.

## Index creation & migration safety

**Before this phase:** Mongoose's own default (`autoIndex: true`) silently called
`createIndexes()` for every model on every connect, in every environment including production.
That's additive-only (it never drops an index), so it wasn't actively dangerous, but it's the
wrong default for production: on a large collection it can slow down app startup, and every one of
N running API instances independently tries to build the same indexes on every deploy/restart.

**Now:** `config/db.ts` sets `autoIndex` to `env.NODE_ENV !== "production"`. Development and test
keep the zero-setup default (an index change in a schema file takes effect the moment the process
restarts — the test suite's own unique-constraint assertions rely on this). Production instead
relies on a deliberate, deploy-time step:

```
npm run --workspace apps/api db:ensure-indexes
```

This runs `scripts/ensureIndexes.ts` (thin CLI wrapper around
`services/indexMaintenance.service.ts`'s `ensureAllIndexes()`), which:
1. Calls `createIndexes()` on every registered model — purely **additive**: it builds whatever
   indexes the current schema defines that don't already exist, and never drops or rebuilds one.
   This is deliberately *not* Mongoose's `syncIndexes()`, which also drops any index not in the
   current schema — exactly the "blindly drop/rebuild everything" pattern this phase avoids.
2. Retires a short, explicitly-named list of indexes that this phase's own schema changes made
   redundant (see "Indexes changed" below) — by exact name, only after confirming the replacement
   index already exists, and treating "already gone" as success. Idempotent and safe to re-run.

**Process for a future index change:** add/change the `schema.index(...)` call, then run
`db:ensure-indexes` against production as a deploy step. If an index is being *removed* or
*replaced* (not just added), also add its old name to `RETIRED_INDEXES` in
`indexMaintenance.service.ts` so it's cleaned up the same safe way, rather than lingering forever.

**Duplicate-data safety before adding a new unique index:** run
`npm run --workspace apps/api db:check-duplicates` (`scripts/checkDuplicateRisk.ts` /
`findDuplicates()`) first. It's read-only — it reports which fields already have duplicate values,
grouped by the field(s) a unique index would key on, and never deletes anything or picks a
"winner." If it finds any, resolving them is a human decision (which document is correct, whether
to merge or delete) — this phase's own scripts deliberately don't attempt that automatically.

## Indexes added this phase

| Model | Index | Type | Query it serves |
|---|---|---|---|
| LoyaltyTransaction | `{restaurantId:1, customerId:1, createdAt:-1}` | compound | `getMyLoyaltyHistory` — a customer's own transaction history at one restaurant, newest first |
| LoyaltyTransaction | `{restaurantId:1, type:1}` | compound | `getLoyaltySummary`'s earn/redeem `$group`/`$sum` aggregations |
| LoyaltyTransaction | `{restaurantId:1, createdAt:-1}` | compound | `getLoyaltySummary`'s restaurant-wide "recent activity" (limit 10) |
| Payment | `{status:1, createdAt:1}` | compound | `reconcileStalePayments` — the payment-reconciliation repeatable job's stale-payment scan |

Each was added because a real, grepped-and-confirmed production query needed it — not
speculatively. See LoyaltyAccount.ts and Payment.ts's own inline comments for the full reasoning.

## Indexes changed/removed

- **LoyaltyTransaction**: the old `restaurantId:{index:true}` and `customerId:{index:true}`
  single-field indexes are retired. `restaurantId` alone was already a strict prefix of all three
  new compound indexes (fully superseded); `customerId` alone had **zero** real callers anywhere in
  the repo (every query touching it also filters `restaurantId` first — confirmed by grepping every
  `LoyaltyTransaction.find/aggregate/countDocuments` call site) — it was dead weight.
- **Payment**: the old `status:{index:true}` single-field index is retired. Grepped every other
  `Payment.find/findOne/aggregate` call site in the repo — none of them filter on `status` without
  also filtering on `_id` or `orderId` (which their own existing indexes already serve), so this
  field-level index existed for exactly one query (`reconcileStalePayments`), and the new
  `{status:1, createdAt:1}` compound serves that query strictly better (it can range-scan
  `createdAt` directly instead of filtering it in application code after an index-assisted
  `status` narrow).

No other existing index was removed or changed. Every other index found during the audit
(`docs` below) was confirmed to still be load-bearing for a real query.

## What else was reviewed and left alone (evidence-backed, not oversight)

- **The public storefront menu read path** (`Category`/`MenuItem`/`ModifierGroup`/the three
  `*LocationOverride` models) is already well-indexed for both the canonical (business-scoped) and
  legacy (restaurant-scoped) resolution paths, *and* the legacy path is Redis-cached for 60 seconds
  (`menuCache.service.ts`) — real DB load from this, the single highest-traffic read in the app, is
  already capped regardless of storefront traffic volume.
- **`order.controller.ts`'s `listRestaurantOrders`** (KDS + Orders Management) caps at 200 orders
  via `.limit()` rather than true pagination — a deliberate, already-documented Phase 6 decision,
  not a new gap. Left unchanged.
- **`LoyaltyAccount`'s `{restaurantId, customerId}` unique index** being used for a plain
  `restaurantId`-then-in-memory-sort-by-`pointsBalance` query (`getLoyaltySummary`'s member list) is
  a real but low-priority gap: this collection's cardinality is bounded by *distinct customer count*
  per restaurant, not order volume — the "Medium volume" collection class Phase 49 itself
  distinguishes from "High volume" ones. Not indexed further this phase.
- **Tenant-isolation query construction** was audited across every controller touching a
  per-tenant nested resource by id (order, table, category, modifier, menu, promotion, loyalty,
  domain, delivery, payment-account, staff, agency-membership, subscription, and more). No genuine
  unguarded cross-tenant read/write was found — every nested-resource mutation filters on its
  tenant field in the same query. See the Phase 49 final report for the full breakdown.

## Duplicate-data findings

`db:check-duplicates` was run against the real development database and found **zero** duplicate
groups across every uniqueness assumption checked (`User.email`, `Restaurant.slug`,
`Business.slug`, `Agency.slug`, `Plan.code`, `DomainMapping.hostname`, `Table.qrToken`,
`SupportTicket.ticketNumber`, `Order.{restaurantId,orderNumber}`,
`AgencyMembership.{agencyId,userId}`, `LoyaltyAccount.{restaurantId,customerId}`) — expected, since
every one of these fields already has a DB-level unique index actively enforcing it. This confirms
the enforcement holds against real data; it says nothing about a production dataset this repo has
never seen.

## Concurrent-duplicate-request safety (uniqueness, application layer)

A systemic pattern was found across four `User.create()`/`AgencyMembership.create()` call sites: a
`findOne` pre-check followed by `create()`, with no handling for the case where a concurrent
request's own `create()` commits in between — the unique index correctly prevents the actual
duplicate row, but the raw MongoDB duplicate-key error was previously unhandled, surfacing as an
unexpected 500 instead of the same clean 409 conflict a slower request would have gotten from the
pre-check. Fixed in `auth.controller.ts`'s `register`, `staff.controller.ts`'s `inviteStaff`,
`agencyMembership.controller.ts`'s `inviteMember` (both its `User.create` and its
`AgencyMembership.create`), and `posCustomer.service.ts`'s `resolvePosCustomerId` (which instead
re-resolves to the winning account, matching its own existing reuse semantics) — the same
`catch (err) { if (err.code === 11000) ... }` pattern already established elsewhere in this
codebase (`business.controller.ts`, `restaurant.controller.ts`, `agency.controller.ts`,
`domain.controller.ts`).
