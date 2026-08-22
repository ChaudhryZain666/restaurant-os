# QR Ordering, Table Management & Dine-in (Phase 7)

This documents the table/QR/dine-in domain added this phase, and the decisions behind it — in
particular the two places where the implementation deliberately deviates from or narrows what the
master prompt suggested, so those choices survive rather than being re-litigated from scratch.

## Table model

`apps/api/src/models/Table.ts` — one document per physical table:

```
{ restaurantId, name, capacity, section?, isActive, qrToken }
```

Nothing about a table's identity depends on which orders reference it. There is no `status` field
stored on the table itself — see "Table status derivation" below for why.

Indexes: `{ restaurantId, isActive, name }` for the admin list view, and a **globally unique**
`{ qrToken }` index — the token alone is enough to find the right table, restaurant included (see
"Security model" for why the resolve endpoint still cross-checks `restaurantId` anyway).

## QR token design

`apps/api/src/services/tableToken.service.ts` generates a 16-byte random hex token
(`crypto.randomBytes(16).toString("hex")`, 32 hex characters, 128 bits of entropy) — not
guessable, not sequential, carries no embedded data (not a JWT, not an encoded ID).

**Stored raw, not hashed** — this is the one deliberate divergence from this codebase's existing
secure-token pattern (`apps/api/src/services/secureToken.service.ts`, used for password
reset/invite links), which stores only a hash and treats the raw value as proven-once-and-discard.
A table's QR token has a fundamentally different lifecycle: it must stay valid and re-displayable
indefinitely (view it again in the admin UI, reprint a damaged table tent) rather than being
consumed once. Hashing would make that impossible without a separate raw-value cache, which just
reintroduces the thing hashing was supposed to avoid. Compromise of a table token is a low-severity
event by design (see "What a QR token can and cannot do" below), so the tradeoff favors
re-displayability over one-time-secret hygiene here.

Regenerating a table's token (`POST /tables/:id/regenerate-qr`) is how a restaurant invalidates a
lost or compromised code without deleting the table — the old token simply stops matching anything
(`resolveTable` is an exact-match lookup).

## QR generation

`apps/api/src/services/qr.service.ts` wraps the `qrcode` npm package's `QRCode.toDataURL()`.
QR images are generated **on demand, never persisted as a file** — every request always encodes
whatever the table's *current* `qrToken` is, so there is no stale-cached-image problem to solve
after a regenerate. The cost of re-rendering a QR image on each admin view is negligible; the
correctness benefit (impossible to serve a stale QR) is worth it.

## QR URL design — deviates from the master prompt's literal suggestion

**Chosen: `/t/:tableToken`** (on the customer storefront, `apps/web`) — not
`/r/:restaurantSlug/t/:tableToken` as the prompt's literal phrasing implied.

Reason: `apps/web` is architecturally a **single-restaurant-per-deployment** app today —
`RestaurantContext.tsx` bootstraps one restaurant from `VITE_RESTAURANT_SLUG` (an env var), by its
own documented "Phase 0" comment, and the roadmap defers real multi-tenant path-based storefront
routing to future work. A URL scheme that encodes a restaurant slug in the path implies multiple
restaurants share one storefront deployment and are disambiguated by path — that isn't how this
app works. Building that routing just to satisfy the QR URL shape would be a materially bigger,
unstated architectural change, explicitly out of scope ("do not invent business rules where the
requirement is unstated" / this phase's actual job is tables and QR, not multi-tenant storefront
routing). The restaurant is already identified by which deployment/domain is being hit; the QR
only needs to add *which table within that restaurant*.

If/when real multi-tenant path routing is built (tracked on the roadmap as future work, alongside
custom domains and multi-location), the URL would naturally become
`/r/:restaurantSlug/t/:tableToken` and `resolveTable` already validates `restaurantId` server-side
regardless of how the frontend obtains it — no backend change would be required.

## Dine-in order/table relationship

- `Order.orderType` gained a third value, `"dine_in"`, alongside the existing `"pickup"` and
  `"delivery"` — both of which are completely unchanged by this phase.
- `Order.tableId` — a live reference to `Table`, set once at order creation.
- `Order.tableName` — a **snapshot** of the table's name at order creation, mirroring the existing
  `orderItemSchema` pattern (which snapshots menu item name/price rather than joining back to a
  possibly-changed/deleted document). This is what makes table deletion safe: historical orders
  render their table name from the snapshot and never need to join back to a `Table` document that
  might no longer exist.
- Index: `{ restaurantId, tableId, status }` (sparse — pickup/delivery orders have no `tableId`).

## Multiple orders per table — explicit decision

**No 1:1 constraint between a table and an order.** Nothing in the schema ties a table to a single
active order; a table can have any number of simultaneous open dine-in orders. This isn't a
special case that was built — it falls out naturally from the existing order-creation flow, which
never assumed "one table = one order" needed enforcing. "Occupied" status and active-order counts
(below) are computed by counting/aggregating, which works identically whether a table has one
active order or five (e.g. a large party ordering in separate rounds, or splitting the check by
having each guest order separately).

## Table status derivation — no redundant stored state

A table has no stored `status` field. `GET /tables` computes `"available"` vs `"occupied"` (plus
an active-order count and the active order numbers) via **one aggregation query per list request**
across all of the restaurant's tables — grouping `Order` documents by `tableId` where
`orderType: "dine_in"` and `status` is one of the active statuses (`pending` through
`out_for_delivery`). This is not N+1 (one query, not one per table), and it means table status can
never drift out of sync with reality the way a manually-toggled stored flag could (e.g. staff
forgetting to mark a table free after the last order there completes). The same
"re-fetch authoritative state, never trust a cached flag" principle already established for
Socket.IO events in Phase 6 applies here to table status.

## Security model

**What a QR token can and cannot do.** Scanning a table's QR code only ever identifies *which
table this is* to the ordering flow — it is not a credential. It grants no elevated access: it
cannot read or modify any other table, any order, any restaurant setting, or authenticate as any
user. The public resolve endpoint's response is deliberately minimal
(`{ id, name, capacity, section }` — no `restaurantId`, no `qrToken` itself, nothing else). A
leaked or physically copied QR code lets someone order "at" that table; it does not let them do
anything an ordinary customer browsing the menu directly couldn't already do.

**`GET /restaurants/:restaurantId/tables/resolve/:token` is public** (no auth) — mirroring the
existing public `GET /restaurants/by-slug/:slug` pattern, since a customer scanning a QR code isn't
logged in yet. It's mounted *before* the router's `requireAuth` middleware in
`table.routes.ts` so it's never accidentally gated by it.

**Defense in depth on the resolve call:** the calling frontend supplies `restaurantId` in the URL,
sourced from its own already-trusted `RestaurantContext` (the env-configured slug bootstrap) —
*not* parsed out of the QR URL itself. `qrToken`'s global uniqueness index would technically make a
token-only lookup sufficient to find the right table, but cross-checking `restaurantId` catches a
QR code that was physically moved or swapped between two different restaurants' premises (e.g. a
prankster swaps table tents), where a token-only lookup would resolve to the wrong restaurant
entirely without complaint.

**Order creation never trusts the client's earlier resolution.** The web app's cart/checkout only
ever sends the opaque `tableToken` string in the `createOrder` request
(`packages/validation/src/order.ts`'s `createOrderSchema`, with a cross-field `.refine()` requiring
it when `orderType === "dine_in"`). `order.controller.ts`'s `createOrder` re-resolves
`Table.findOne({ restaurantId, qrToken: tableToken, isActive: true })` from scratch, server-side —
the same "never trust an earlier client-side check" pattern already used for promo codes
(`validatePromoCode` is always re-run fresh at order creation, never trusting the cart preview's
earlier discount amount). A client cannot supply a `tableId` directly at all; there is no code path
that accepts one.

**RBAC:** a new permission, `restaurant.tables.manage`, gates all table CRUD, QR
view/regenerate — granted to `restaurant_owner` and `restaurant_manager` only (not
`restaurant_staff`, not `kitchen_staff`), matching the existing pattern used for
`restaurant.payments.manage` (Phase 5) and `restaurant.audit.read` (Phase 6).

**Opt-in, off by default:** `Restaurant.settings.dineInEnabled` defaults to `false`. A restaurant
must explicitly turn dine-in ordering on (Settings → Ordering) before any QR code — even a validly
resolved one — can actually be used to place an order; `createOrder` checks this independently of
whether the table itself resolves.

**Tenant isolation:** every table route requires `requireTenantMatch()` alongside
`requirePermission("restaurant.tables.manage")`, identical to every other restaurant-scoped admin
route in this codebase — a manager for restaurant A can never manage, view, or regenerate a QR code
for restaurant B's tables.

**Keeping QR URLs out of search indexing:** `apps/web/public/robots.txt` disallows `/t/`, and the
`/t/:tableToken` route additionally injects a `<meta name="robots" content="noindex,nofollow">` tag
while mounted (removed on navigating away) as a second layer, covering the case where a `/t/...`
URL got linked from somewhere outside this app's own crawl surface.

## Table deletion

Deletion is **allowed but guarded**, not the primary path — deactivating a table
(`isActive: false`, via the same `PATCH` used for edits) is the expected way to retire a table
without destroying it, matching Part 23's "prefer deactivation over destructive deletion." Deletion
exists for genuine mistakes (a duplicate/misnamed table created by accident) rather than
end-of-service teardown, and is blocked outright if the table has any currently-active dine-in
order (`ApiError.conflict`, "deactivate it instead, or wait until the order is complete") — that
specific case would otherwise leave an in-progress order's `tableId` pointing at nothing. Deletion
of a table with only *historical* (completed/cancelled) orders is allowed and safe, because
`Order.tableName` is a snapshot, not a live join.

## What was deliberately NOT built this phase

Per the master roadmap's explicit exclusions, reiterated here so they aren't mistaken for
oversights:

- **A floor-plan editor.** Tables are a flat list (with an optional free-text `section` label like
  "Patio" or "Bar") — no visual layout, no drag-and-drop positioning, no seating chart.
- **Real multi-tenant path-based storefront routing** (`/r/:slug/...`). See "QR URL design" above.
- **Kitchen station routing for dine-in items** — out of scope, already documented as a Phase 6
  non-build in `docs/operations-architecture-boundaries.md`; dine-in orders appear on the KDS the
  same single-board way every other order does, just with a "Dine-in · Table N" badge.
- **POS/printer integration** for dine-in — same reasoning as `operations-architecture-boundaries.md`.
- Anything from the master roadmap unrelated to dine-in (delivery zones/tracking, payouts,
  commissions, SaaS billing, multi-location, WhatsApp, AI, white-label, agency management, public
  API) — untouched by this phase, as instructed.
