# Architecture

## Why Express, not NestJS

An initial MVP (menu/cart/checkout/orders/loyalty) was already built and verified end-to-end on
Node.js + Express + TypeScript before this platform-scale foundation work started. NestJS was
considered for this phase, but migrating a working, tested backend to a different framework
purely to match a template — with no functional benefit — would violate the project's own rule
against rewriting working architecture without a clear reason. Express stays. The organizational
ideas NestJS is good at (modules with clear responsibilities, dependency-light controllers,
centralized cross-cutting concerns) are reproduced with plain Express conventions instead:
- **type-based folders** (`controllers/`, `models/`, `routes/`, `services/`, `middleware/`) rather
  than one-folder-per-domain — this was the existing, working structure; reorganizing it around
  "modules" would have been churn for its own sake.
- **`src/common/`** holds cross-cutting infrastructure that would be a NestJS interceptor/filter/pipe
  in that framework: the response envelope, error codes, the structured logger, and request-ID
  middleware.

## Why a monorepo, and this package split

```
apps/
  api/     Express API (all business logic, all tenants)
  web/     Customer storefront (React + Vite)
  admin/   Restaurant dashboard + platform admin (React + Vite, role-gated routes)
packages/
  types/       Shared TypeScript types + the RBAC role→permission table (the contract
               both frontend and backend must agree on)
  validation/  Shared zod schemas — the API validates requests with them; frontend
               forms will validate with the same schemas via React Hook Form's zod resolver
  utils/       Shared browser API client (fetch wrapper with the 401→refresh→retry cycle)
  config/      Shared tsconfig base, ESLint flat configs, Prettier config
  ui/          Shared shadcn-style components (currently just Button — grows as admin/web
               UI actually gets built)
infrastructure/
  docker/      One Dockerfile per app (development images — see docker-compose.yml)
```

Splitting `types`/`validation`/`utils`/`config`/`ui` instead of one `packages/shared` matters
because they have different consumers and different release cadence: `types` and `validation`
are consumed by both the API and every frontend; `ui` and `config` are frontend/tooling-only;
mixing them in one package means every consumer pulls in dependencies (React, zod, ESLint) it
doesn't need.

## Multi-tenancy (the most important architectural requirement)

This is a multi-restaurant SaaS platform, not one app per restaurant. Every restaurant-owned
resource (`MenuItem`, `Order`, `LoyaltyAccount`) carries a `restaurantId`. The rule that makes
this actually safe:

**Authorization never trusts a client-supplied `restaurantId`.** A JWT access token issued to a
restaurant-scoped user (`restaurant_owner`/`manager`/`staff`/`kitchen_staff`) embeds that user's
own `restaurantId` at login time. `middleware/tenant.ts`'s `requireTenantMatch()` compares the
`:restaurantId` route param against `req.user.restaurantId` — set from the *verified* JWT, never
from the URL — and rejects the request if they don't match. A staff member editing the URL by
hand to point at a different restaurant's ID gets a 403, not a data leak. `platform_admin` is the
one role exempt, since managing all tenants is its job.

Route-level tenant matching isn't sufficient by itself when a resource ID (e.g. a menu item ID)
is looked up independently of the restaurant in the URL — `requireTenantMatch()` proves the
*caller* belongs to restaurant X, not that the *resource being mutated* belongs to restaurant X.
Every mutating query in `controllers/menu.controller.ts` and `controllers/order.controller.ts`
therefore filters by `restaurantId` in the Mongo query itself (`findOneAndUpdate({ _id, restaurantId }, ...)`),
so a guessed/leaked ID from another tenant simply doesn't match and returns 404.

Customers are **not** tenant-scoped — one customer account orders from many restaurants (like
any food-delivery marketplace), so `User.restaurantId` is only ever set for the four
restaurant-scoped roles. Loyalty accounts are keyed on `(restaurantId, customerId)` since each
restaurant runs its own loyalty program.

## RBAC

Six roles (`platform_admin`, `restaurant_owner`, `restaurant_manager`, `restaurant_staff`,
`kitchen_staff`, `customer`) map to permission strings (`restaurant.menu.write`,
`restaurant.orders.manage`, ...) in `packages/types/src/types/rbac.ts` — one static table,
shared by the API (enforcement, via `middleware/rbac.ts`'s `requirePermission()`) and the
frontends (UI gating, e.g. which nav sections `apps/admin` shows). Route handlers list the
permissions they need; nothing hardcodes "if role === admin" in a controller.

## Response envelope

Every API response is one of:
```ts
{ success: true, data: T, requestId: string }
{ success: false, error: { code: string, message: string, details?: unknown }, requestId: string }
```
`code` is a stable machine-readable string (`packages` — see `apps/api/src/common/errorCodes.ts`),
`message` is for humans, `details` carries structured validation errors. The shared frontend
`apiClient` (`packages/utils`) throws `ApiClientError` with `.code` set from this envelope, so
frontend error handling can switch on `code` rather than parsing message strings.

## What's deliberately not built yet

Menu/product management UI, the full order engine, payments, delivery, promotions, loyalty UI,
AI features, WhatsApp, analytics dashboards, subscription billing, and white-labeling are out of
scope for this phase — see `docs/roadmap.md`. The loyalty *data model and points engine* already
exists (it predates this foundation work and was kept), but there's no loyalty management UI yet.
