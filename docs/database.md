# Database

MongoDB via Mongoose. One database, tenant isolation enforced in application code (see
`docs/architecture.md` for why) rather than via separate databases per restaurant — separate
databases per tenant doesn't scale to "thousands of restaurants" (connection overhead, migration
fan-out) and isn't necessary since every tenant-owned collection is indexed on `restaurantId`.

## Collections (Phase 0)

| Collection | Tenant-scoped? | Notes |
|---|---|---|
| `users` | Only for restaurant-scoped roles (`restaurantId` set) | `customer` and `platform_admin` are platform-wide |
| `restaurants` | — | `slug` is unique, used for public storefront lookup |
| `menuitems` | Yes (`restaurantId`) | Compound index `{ restaurantId, category, name }` |
| `orders` | Yes (`restaurantId`) | Compound index `{ restaurantId, status, createdAt }` |
| `loyaltyaccounts` | Yes (`restaurantId`) | Unique compound index `{ restaurantId, customerId }` |
| `loyaltytransactions` | Yes (`restaurantId`) | Append-only ledger backing `loyaltyaccounts.pointsBalance` |

Collections listed in the original Phase 0 spec but not yet created (`locations`, `categories`,
`products`, `modifierGroups`, `carts`, `payments`, `deliveryZones`, `promotions`,
`notifications`, `subscriptions`, `staff`, `auditLogs`) get added when the feature that needs
them is actually built, not before — see `docs/roadmap.md`.

## Conventions

- Every schema uses `{ timestamps: true }` (`createdAt`/`updatedAt`).
- Every schema sets a `toJSON` transform (`apps/api/src/utils/schemaOptions.ts`'s `idTransform`)
  that renames `_id` → `id` (string) and strips `__v`. Mongoose does **not** do this by default —
  omitting it is a real bug class (frontend code expecting `.id` silently getting `undefined`),
  caught once already during the original MVP build.
- `User`'s `toJSON` additionally strips `passwordHash` — defense in depth on top of controllers
  already never selecting/returning it.

## Transactions require a replica set

`Order` creation writes the order **and** the loyalty ledger entry (earn or redeem) in one
multi-document Mongo transaction (`mongoose.startSession()` + `withTransaction()`), so a partial
failure never leaves an order without its matching loyalty entry. **Standalone `mongod` does not
support transactions** — `docker-compose.yml`'s `mongo` service runs `--replSet rs0` with a
healthcheck that self-initiates the replica set (`rs.initiate()` on first health check). Running
MongoDB outside Docker requires the same: start `mongod --replSet rs0` and run
`mongosh --eval "rs.initiate()"` once. Skipping this produces:
`Transaction numbers are only allowed on a replica set member or mongos` — hit and fixed once
already during initial setup.

## Redis

Two uses today: menu-list caching (`menu:<restaurantId>:available`, 60s TTL, invalidated on any
write to that restaurant's menu) and the refresh-token allowlist (`refresh:<userId>:<jti>`,
TTL matching the refresh token's expiry — enables server-side revocation on logout/rotation,
which a stateless JWT alone can't do). BullMQ uses a second Redis connection
(`maxRetriesPerRequest: null`, required by BullMQ) — see `docs/api.md` for job infrastructure.
