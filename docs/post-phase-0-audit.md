# Post-Phase-0 Architecture Audit

Date: 2026-08-11. Scope: verification only — no code changes, no new features, no restructuring.
Every claim below is based on reading the actual current source (file paths and line numbers
given), not on memory of what was intended.

---

## 1. Tenant isolation

### The chain

```
JWT payload (signed at login/register, apps/api/src/services/token.service.ts:23)
  { sub: userId, role, restaurantId? }
        │
        ▼
requireAuth (apps/api/src/middleware/auth.ts:14-27)
  verifies the JWT, sets req.user = { id, role, restaurantId }
  restaurantId here comes ONLY from the verified token payload — never from any
  request input.
        │
        ▼
requireTenantMatch() (apps/api/src/middleware/tenant.ts:13-24)
  compares req.params.restaurantId (the URL) against req.user.restaurantId (the token).
  platform_admin is exempted; every other role gets 403 on mismatch.
        │
        ▼
requirePermission(...) (apps/api/src/middleware/rbac.ts:6-13)
  checks the role's static permission table (packages/types/src/types/rbac.ts)
        │
        ▼
controller
  reads restaurantId from req.params (already proven == req.user.restaurantId
  by requireTenantMatch, for non-admin roles) and passes it as an explicit argument
  down the call chain — never re-derived from req.body.
        │
        ▼
service (apps/api/src/services/loyalty.service.ts)
  receives restaurantId as a plain parameter, uses it directly in Mongo filters
        │
        ▼
database query
  every tenant-owned collection query includes restaurantId in the filter
```

`req.user.restaurantId` is the single source of truth for "which tenant does this
request belong to." It is set once, in `requireAuth`, from the cryptographically verified JWT.
Nothing downstream re-reads it from the client.

### Per-model verification

| Model | `restaurantId` field | Every query scoped? | Notes |
|---|---|---|---|
| `User` | optional (`models/User.ts:11`), set only for staff roles | N/A (not a per-request-scoped resource) | `email` has a **global** unique index, not compound with `restaurantId` — confirms customers are platform-wide by design (see §2). |
| `MenuItem` | required (`models/MenuItem.ts:6`) | Yes — `listMenu`, `createMenuItem`, `updateMenuItem`, `deleteMenuItem` all filter/write with `restaurantId` (`controllers/menu.controller.ts:23,32,39,47`) | See finding below: `updateMenuItem`'s update body is not schema-validated. |
| `Order` | required (`models/Order.ts:16`) | Yes — `restaurantId` is looked up once in `createOrder` (`controllers/order.controller.ts:13`) from the URL and reused for the `MenuItem` lookup, the `Order.create`, and both loyalty calls, all within one variable scope | Cross-tenant `menuItemId` guessing is blocked because `MenuItem.find` is scoped to the same `restaurantId` (line 21) — an ID belonging to another restaurant simply won't match and the order is rejected. |
| `LoyaltyAccount` | required, compound-unique with `customerId` (`models/LoyaltyAccount.ts:6,13`) | Yes — `services/loyalty.service.ts` takes `restaurantId` as its first parameter in every function | See §5 for the transaction-consistency proof. |

### Could a client supply a different `restaurantId` and bypass authorization?

**No route found where this works.** Specifically checked:
- Menu/order-management routes (`POST/PATCH/DELETE menu`, `GET/PATCH restaurant orders`): the
  `:restaurantId` URL segment is checked against the JWT by `requireTenantMatch()` before the
  controller runs. Changing it in the URL, body, or query string does nothing — the controller
  never reads `req.body.restaurantId`.
- Order creation (`POST /restaurants/:restaurantId/orders`): **intentionally** does not require
  tenant match, because customers aren't tenant-bound (see §2) — any authenticated customer can
  order from any active restaurant. This is correct by design, not a gap: the restaurant must be
  `status: "active"` (`controllers/order.controller.ts:17`), and prices/items are re-derived from
  that same restaurant's own `MenuItem` collection, so there's no cross-tenant price or menu leak.
- JWT manipulation: the token is HMAC-signed (`JWT_ACCESS_SECRET`); a client cannot forge a
  different `restaurantId` claim without the secret.

**One real gap found — cross-tenant reassignment via the menu PATCH endpoint:**

`menu.routes.ts:27-33` does **not** run `validateBody(menuItemSchema)` on `PATCH
/restaurants/:restaurantId/menu/:id` (only POST does). `updateMenuItem`
(`controllers/menu.controller.ts:37-43`) passes the raw, unvalidated `req.body` straight into
`MenuItem.findOneAndUpdate({ _id: id, restaurantId }, req.body, { new: true })` — **without**
`runValidators: true`. Consequences:
- A user with legitimate `restaurant.menu.write` permission for restaurant A (who correctly
  passes `requireTenantMatch` for A) can include `"restaurantId": "<restaurant B's id>"` in the
  PATCH body. The filter still matches on A (so they can only *target* their own items), but the
  **update document is applied as-is**, reassigning that item to restaurant B — a tenant-boundary
  violation by a legitimately-authenticated-but-wrong-tenant write.
- Because `runValidators` isn't set, schema constraints (`price: { min: 0 }`, the `category`
  requirement, etc.) are silently skipped on update — e.g. a negative price could be written.

This does **not** allow an *unauthorized* user to touch another tenant's data (they still need
real `menu.write` permission on *some* restaurant first) — it's a privilege-boundary leak between
tenants who both have legitimate staff accounts, not an auth bypass for outsiders. See technical
debt #1.

---

## 2. Customer / order model

**Customers already support ordering from multiple restaurants — this is the current design, not a gap.**

- `User.role: "customer"` has `restaurantId: undefined` (`models/User.ts:11` — optional, "set
  only for restaurant-scoped roles"). Customers are never tied to a single restaurant.
- `User.email` has a single **global** unique index (`models/User.ts:19`) — one account, one
  email, usable across every restaurant on the platform.
- `Order.customerId` + `Order.restaurantId` are independent fields; nothing prevents (and my
  manual smoke test during Phase 0 confirmed) the same `customerId` appearing in orders under
  multiple different `restaurantId`s.
- `LoyaltyAccount` has a **compound** unique index `{ restaurantId: 1, customerId: 1 }`
  (`models/LoyaltyAccount.ts:13`), not a unique index on `customerId` alone — meaning one customer
  can have *N* separate loyalty accounts, one per restaurant they've ordered from, each with its
  own independent points balance and tier.

So the actual current shape is exactly:
```
Customer (one User doc, global)
├── Order[] where restaurantId = A, LoyaltyAccount{restaurantId:A, customerId}
├── Order[] where restaurantId = B, LoyaltyAccount{restaurantId:B, customerId}
└── ...
```
No change is needed for this requirement — it already works this way.

---

## 3. Restaurant ownership

### Representation

- **Platform Admin**: `User.role === "platform_admin"`, `restaurantId` unset. Not tied to any
  restaurant.
- **Restaurant Owner**: `User.role === "restaurant_owner"`, `restaurantId` set to the restaurant
  they own. Set exactly once, in `createRestaurant` (`controllers/restaurant.controller.ts:18-21`):
  a platform_admin supplies an existing user's ID as `ownerId`; that user's `role` and
  `restaurantId` are both overwritten server-side. `Restaurant.ownerId` (`models/Restaurant.ts:8`)
  separately records the same relationship on the restaurant document.
- **Restaurant Staff** (`restaurant_manager`/`restaurant_staff`/`kitchen_staff`): same shape as
  owner — `role` + `restaurantId` on the `User` doc — but there is currently **no route that
  creates these roles** (no staff-invite endpoint exists yet; this matches `docs/roadmap.md`,
  which lists it as unbuilt).

### Can a restaurant owner access another restaurant?

Checked all four vectors:

| Vector | Result |
|---|---|
| URL parameters | Blocked by `requireTenantMatch()` on every tenant-scoped mutating route (403 if `:restaurantId` ≠ their token's `restaurantId`) |
| Request body | No route trusts a body-supplied `restaurantId` for authorization anywhere — except the PATCH-menu mass-assignment gap in §1, which lets them *write into* another tenant's `restaurantId` field, not *read/act as* that tenant |
| Query parameters | No route reads `restaurantId` from a query string at all |
| JWT manipulation | Not possible without the HMAC secret; the token is verified, not merely decoded |
| Direct Mongo IDs (guessing another restaurant's `_id`) | Blocked at the query level too, not just the middleware level — e.g. `updateMenuItem`/`deleteMenuItem`/`updateOrderStatus` filter by `{ _id: id, restaurantId }` together, so even if `requireTenantMatch` were somehow skipped, a guessed resource ID from another tenant simply won't match the filter and returns 404 |

Verified live during Phase 0 (not just read in code): a second restaurant's owner got HTTP 403
attempting to `POST` a menu item and `GET` the order list of the first restaurant, by ID.

**One inconsistency found (not a security hole — the opposite: an unintended restriction):**
`requireTenantMatch()` explicitly exempts `platform_admin` ("manages all tenants" —
`middleware/tenant.ts:11`), but `ROLE_PERMISSIONS.platform_admin` in
`packages/types/src/types/rbac.ts:36` grants only `platform.restaurants.manage` and
`platform.users.manage` — **no `restaurant.*` permissions at all**. Every tenant-scoped mutating
route chains `requireTenantMatch()` *and* `requirePermission("restaurant.*.*")`. Result:
platform_admin passes the tenant check but then fails the permission check on menu
create/update/delete and on restaurant order list/status-update — a platform_admin **cannot
currently manage any restaurant's menu or orders**, despite the code's stated intent. The one
exception is `getOrder` (`controllers/order.controller.ts:93-96`), which has its own inline
`role === "platform_admin"` bypass and works correctly. See technical debt #5.

---

## 4. Order security

**Confirmed: prices are entirely server-authoritative. A client cannot submit a price.**

- `createOrderSchema` (`packages/validation/src/order.ts:3-8`) only accepts
  `{ menuItemId: string, quantity: number }` per item — no `price` field exists in the schema.
  Zod's default object mode is `strip`, so even if a client sends `"price": 1` in the JSON body,
  `validateBody` middleware (`middleware/validate.ts:11`, `req.body = result.data`) discards it
  before the controller ever runs.
- Even setting that aside, `createOrder` (`controllers/order.controller.ts:26-35`) never reads
  `item.price` from the request at all — it builds `orderItems` exclusively from
  `menuItem.price`/`menuItem.name`, where `menuItem` comes from a fresh `MenuItem.find(...)`
  database read (line 21) keyed by `menuItemId` **and** `restaurantId`. There is no code path
  where a client-supplied number reaches `subtotal`/`total`.
- Tested live: a $1000 item cannot become $1 — the only way to change what an order charges is to
  change the `MenuItem` document in the database (which itself requires `restaurant.menu.write`
  on that tenant).

**`restaurantId` on checkout**: taken from the URL path (`/restaurants/:restaurantId/orders`),
verified to reference an existing, `status: "active"` restaurant (line 17) before anything else
happens. It is not "trusted" in the sense of granting elevated access — it just selects *which*
restaurant's menu the item lookup is scoped against, and a suspended/pending restaurant can't
receive orders at all.

---

## 5. Loyalty integrity

**Confirmed atomic and tenant-consistent.**

In `createOrder` (`controllers/order.controller.ts:42-74`), `restaurantId` is destructured once
from `req.params` at the top of the function and reused, as the same JavaScript value, for:
1. `Order.create([{ restaurantId, ... }], { session })` (line 49)
2. `redeemPoints(restaurantId, customerId, ..., session)` (line 62)
3. `earnPoints(restaurantId, customerId, order.id, total, session)` (line 65)

All three run inside `session.withTransaction(...)` (line 45), and every one of those calls is
passed the same Mongo `session` — so `Order.restaurantId` and the corresponding
`LoyaltyAccount`/`LoyaltyTransaction.restaurantId` writes either all commit together or all abort
together. There is no code path where an order could be created under restaurant A while its
loyalty entry lands under restaurant B, or where a partial failure leaves the two out of sync —
Mongo's transaction guarantees this, and the session is threaded correctly.

`LoyaltyAccount`'s compound unique index (`restaurantId + customerId`) additionally guarantees
`earnPoints`'s `findOneAndUpdate(..., { upsert: true })` (`services/loyalty.service.ts:30-34`)
can never create two separate point balances for the same customer at the same restaurant.

---

## 6. Redis isolation

Two key patterns exist in the codebase (checked via full-repo search — these are the only two):

```
menu:<restaurantId>:available          # config/menu.controller.ts:11 — 60s TTL, per-restaurant cache
refresh:<userId>:<jti>                  # services/token.service.ts:19-20 — refresh-token allowlist
```

- **Menu cache**: keyed by `restaurantId`, so restaurant A's cached menu and restaurant B's
  cached menu are different Redis keys — no possibility of one tenant's menu being served from
  another's cache entry. Cache is invalidated (`redis.del`) on every write, scoped to that same
  key (`menu.controller.ts:33,41,49`).
- **Refresh tokens**: keyed by `userId`, not `restaurantId` — correct, since a refresh token
  belongs to one user account, and a user belongs to at most one restaurant (or none, for
  customers/platform_admin) at any given time. No cross-tenant leakage risk here because there's
  nothing tenant-shaped about this key to begin with.

No other Redis usage exists yet (BullMQ uses its own connection/internal key namespace for queue
bookkeeping, unrelated to tenant data).

---

## 7. API architecture

Route groups under `/api/v1` (`routes/index.ts`):

```
/api/v1/auth                              register, login, refresh, logout — public
                                           me — requireAuth only
/api/v1/orders                            mine, :id — requireAuth (tenant check is inline in
                                           the controller for :id, since it's not URL-scoped)
/api/v1/restaurants                       POST — requireAuth + requireRole(platform_admin)
                                           /me — requireAuth
                                           /by-slug/:slug — public
/api/v1/restaurants/:restaurantId/menu    GET — public
                                           POST/PATCH/DELETE — requireAuth + requireTenantMatch
                                           + requirePermission(menu.write)
/api/v1/restaurants/:restaurantId/orders  POST — requireAuth only (any customer)
                                           GET — requireAuth + requireTenantMatch
                                           + requirePermission(orders.read)
                                           PATCH :id/status — requireAuth + requireTenantMatch
                                           + requirePermission(orders.manage)
/api/v1/restaurants/:restaurantId/loyalty GET me, me/history — requireAuth (further scoped by
                                           customerId in the query, not by tenant middleware)
```

`/health` (Mongo/Redis check) and `/api/docs` (Swagger UI) are mounted directly on the app,
outside `/api/v1` — a version-agnostic health check and a documentation UI aren't really
"the API" in the versioning sense.

Authentication (`requireAuth`) and authorization (`requireTenantMatch`/`requirePermission`) are
applied **per-route**, not globally — there is no blanket `app.use(requireAuth)`. This means
every new route must explicitly opt into auth; nothing enforces that by default. Worth being
deliberate about when adding routes in future phases (a forgotten `requireAuth` fails open).

---

## 8. Package architecture

Actual dependency direction, read from every `package.json`'s `dependencies` (not from what
*should* be declared — see the gaps noted below):

```
packages/types        (no @restaurant/* deps — leaf)
packages/validation    → zod only (no @restaurant/* deps)
packages/utils         → @restaurant/types  [UNDECLARED — see below]
packages/ui            → external only (class-variance-authority, clsx, tailwind-merge)
packages/config        → external only (eslint/prettier tooling)

apps/api               → @restaurant/types, @restaurant/validation
apps/web                → @restaurant/types, @restaurant/ui, @restaurant/utils
apps/admin              → @restaurant/types, @restaurant/ui, @restaurant/utils
```

**No circular dependencies.** The graph is a clean DAG: `types` is the common root that
everything else (directly or transitively) depends on; nothing in `packages/` depends on
anything in `apps/`.

**Two undeclared-dependency findings** (both confirmed by grepping actual import statements
against actual `package.json` `dependencies`/`devDependencies`):

1. `packages/utils/src/apiClient.ts:1` does `import type { ApiResponse } from "@restaurant/types"`,
   but `packages/utils/package.json` does not list `@restaurant/types` anywhere. This resolves
   today only because npm workspaces hoists every sibling workspace package into the root
   `node_modules` regardless of whether it's a declared dependency.
2. Six files reference `@restaurant/config` (`apps/{api,web,admin}/eslint.config.js`,
   `apps/api/tsconfig.json`, `packages/{types,validation,utils}/tsconfig.json`) — **none** of
   their `package.json`s declare `@restaurant/config` as a dependency or devDependency.

Both work today purely as a side effect of npm's flat hoisting. They would break under `pnpm`
(which does not hoist phantom dependencies by default), under stricter npm workspace settings, or
if any of these packages were ever extracted/published independently. See technical debt #6.

---

## 9. Docker

Docker is not installed on this machine, so nothing below was run — this is static inspection of
`docker-compose.yml`, the three Dockerfiles, and env-var references only, per your instruction.

**Two issues likely to prevent correct startup, both found by reading the files carefully:**

1. **The `packages` volume mount overwrites the image's compiled output.** Every Dockerfile
   (`infrastructure/docker/{api,web,admin}.Dockerfile`) runs `RUN npm run build:packages` during
   the image build, producing `packages/{types,validation,utils}/dist/`. But
   `docker-compose.yml` then bind-mounts `./packages:/repo/packages` (lines 59, 75, 89) for all
   three services at *runtime*. Since `dist/` is git-ignored, the host's `packages/` directory
   won't contain `dist/` unless someone has independently run `npm run build:packages` on the
   host first — which isn't part of the documented `docker compose up -d --build` flow. Net
   effect: `@restaurant/types`/`validation`/`utils` (resolved via each package's
   `"main": "./dist/index.js"`) will likely fail to resolve inside the containers, breaking `api`,
   `web`, and `admin` all at once. (The intent of that mount — live-editing shared package source
   without a rebuild — is reasonable; the mechanism just clobbers the build it depends on.)

2. **The Mongo replica-set healthcheck advertises the wrong hostname.** The `mongo` service's
   healthcheck (`docker-compose.yml:12-13`) runs
   `rs.initiate({_id:'rs0', members:[{_id:0, host:'localhost:27017'}]})`. Inside the `mongo`
   container, `localhost` refers to that container itself. But the `api` container connects via
   the Compose service name (`MONGO_URI: mongodb://mongo:27017/...`, line 47) — during replica-set
   discovery, MongoDB's driver uses the *advertised* member host from `rs.status()`, which will be
   `localhost:27017`, unreachable from the `api` container's network namespace. This is a common,
   well-documented Docker+Mongo-replica-set pitfall. It would likely break exactly the operation
   this whole replica-set setup exists for — order-creation transactions — the first time this is
   run via `docker compose up`, even though the same transaction logic is verified working outside
   Docker. The member host should be the Compose service name (`mongo:27017`), not `localhost`.

**One fragility worth knowing about, not currently broken:** `web.Dockerfile` and
`admin.Dockerfile` never `COPY packages/validation/package.json` before `RUN npm install`, yet
both run the shared `build:packages` script, which unconditionally builds `packages/validation`
(needing its `zod` dependency). This currently works only because `zod` happens to already be a
direct dependency of `apps/web`/`apps/admin` for unrelated reasons (planned React Hook Form
validation) and gets hoisted anyway. If `zod` were ever removed from those apps' own
`package.json`, these two image builds would break with "Cannot find module 'zod'". Also: `web`
and `admin` don't need `packages/validation` at all (they only depend on `types`/`ui`/`utils`) —
building it is wasted work, not a correctness bug.

**Env-var references checked and consistent:** every variable `apps/api/src/config/env.ts`'s zod
schema requires (`MONGO_URI`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, etc.) is
supplied in the `api` service's `environment:` block, with the two JWT secrets sourced from the
root `.env` (which `docker-compose.yml` reads automatically) — this part is correctly wired.

---

## 10. Top 10 technical risks

Ordered by severity.

**1. Menu PATCH endpoint allows cross-tenant reassignment via unvalidated body**
Severity: **High**
Why it matters: `PATCH /restaurants/:restaurantId/menu/:id` skips `validateBody` and doesn't set
`runValidators: true`, so a legitimately-authorized user (real `menu.write` permission on *some*
tenant) can smuggle `restaurantId` (or any other field, including bypassing `price: min 0`) into
the update body and move/corrupt data across the tenant boundary the rest of the system carefully
enforces.
Recommended phase: fix before Phase 1 — small, contained change (add `validateBody(menuItemSchema.partial())` and/or explicit field allowlisting).

**2. Docker Compose volume mount overwrites compiled workspace packages**
Severity: **High**
Why it matters: as documented in §9, this likely breaks module resolution for all three app
containers the first time anyone actually runs `docker compose up -d --build`, since `dist/` is
git-ignored and gets clobbered by the bind mount.
Recommended phase: fix before Docker is actually used for the first time.

**3. Mongo replica-set healthcheck advertises `localhost` instead of the Compose service name**
Severity: **High**
Why it matters: likely breaks order-creation transactions specifically inside Docker — the one
feature this whole replica-set setup exists to support — even though it's verified working
outside Docker.
Recommended phase: fix before Docker is actually used for the first time (same phase as #2).

**4. No dedicated rate limiting on `/auth/login` or `/auth/register`**
Severity: **Medium**
Why it matters: only a global, generous rate limit exists (1000 req/15min per IP, `app.ts:38-44`,
explicitly flagged in its own code comment as a placeholder). Credential-stuffing/brute-force
attempts against login aren't meaningfully throttled beyond that.
Recommended phase: before any real user accounts exist (Phase 1).

**5. `platform_admin` cannot manage restaurant menus or orders despite code stating it can**
Severity: **Medium**
Why it matters: not a security hole (it's overly restrictive, not permissive), but it's a real
functional gap that will surface as soon as anyone builds platform-admin tooling expecting the
documented "manages all tenants" behavior to work.
Recommended phase: decide the intended platform_admin capability set before building the
platform-admin dashboard.

**6. Undeclared workspace dependencies relying on npm hoisting**
Severity: **Medium**
Why it matters: `packages/utils` uses `@restaurant/types` without declaring it; six files
reference `@restaurant/config` without any declaring it. Works today by accident of npm's flat
`node_modules`; fragile against package-manager changes or future package extraction/publishing.
Recommended phase: low-urgency cleanup, anytime.

**7. No pagination on any list endpoint**
Severity: **Medium** (currently Low in practice, will become Medium/High with real usage)
Why it matters: `listMenu`, `listMyOrders`, `listRestaurantOrders`, `getMyLoyaltyHistory` all
return unbounded result sets. Fine at seed-data scale; degrades once a restaurant has hundreds of
menu items or a customer has years of order history.
Recommended phase: before building the admin dashboard's list views, where this first becomes
visible.

**8. Restaurant creation has a check-then-act race with an unmapped error path**
Severity: **Low**
Why it matters: `createRestaurant` does `findOne({slug})` then `create(...)` — two concurrent
requests with the same slug could both pass the check. The schema's `unique: true` index would
catch it at the DB layer, but that duplicate-key error isn't caught and mapped to a clean
`ApiError.conflict` — it would currently surface as an unhandled 500. Low-frequency, admin-only
operation today.
Recommended phase: whenever restaurant creation becomes self-service / higher-volume.

**9. `revokeAllRefreshTokens()` is dead code, and its design (Redis `KEYS`) won't scale**
Severity: **Low**
Why it matters: defined in `token.service.ts` but never called anywhere — there's no
"log out everywhere" or password-change session invalidation flow yet. When it does get wired up,
it uses `redis.keys()` (`token.service.ts:53`), a blocking, non-scaling operation; should be
`SCAN`-based instead.
Recommended phase: when building account security features (password reset, "log out all
devices").

**10. No password-reset / account-recovery flow**
Severity: **Low** for Phase 0 (explicitly out of scope), becomes **Medium/High** before real users
Why it matters: register/login/refresh/logout/me is the complete auth surface today. Not a defect
— just a real gap that blocks real user onboarding.
Recommended phase: before any real (non-test) customer or restaurant-owner account is created.
