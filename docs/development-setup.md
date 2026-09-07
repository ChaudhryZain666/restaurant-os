# Development Setup

## Prerequisites

- Node.js 22+ and npm (this repo uses npm workspaces — no pnpm/yarn)
- Docker + Docker Compose (recommended), **or** local MongoDB 7+ and Redis 7+
- Git

## With Docker (recommended)

```
cp .env.example .env                      # JWT secrets used by docker-compose
docker compose up -d --build
```

This starts `mongo` (as a single-node replica set — required for order transactions, see
`docs/database.md`), `redis`, `api` (port 4000), `web` (port 5173), and `admin` (port 5174), all
with source mounted for hot reload. Seed sample data once the containers are healthy:
```
docker compose exec api npm run seed -w apps/api        # commercial Plan catalog only
docker compose exec api npm run seed:demo -w apps/api    # demo restaurant, accounts, sample data
```

## Without Docker

```
npm install
npm run build:packages           # apps/api and the frontends import compiled package output
```

Start MongoDB as a replica set and Redis, then per app:
```
cp apps/api/.env.example apps/api/.env    # fill in real JWT secrets
cp apps/web/.env.example apps/web/.env
npm run seed -w apps/api          # commercial Plan catalog only — safe to run against production
npm run seed:demo -w apps/api     # demo restaurant, accounts, sample data — LOCAL DEV/DEMO ONLY

npm run dev:api      # http://localhost:4000
npm run dev:web       # http://localhost:5173 (customer storefront)
npm run dev:admin     # http://localhost:5174 (restaurant/platform admin)
```

`npm run seed` (`scripts/seed.ts`) only ensures the real commercial Plan catalog exists. It creates
no accounts of any kind and is safe to run against a real production database.

`npm run seed:demo` (`scripts/seed-demo-data.ts`) is **local development/demo only — never run this
against production**. It creates the following well-known accounts (seeded accounts):
- Platform admin: `platform-admin@restaurant.local` / `Admin123!`
- Demo restaurant owner: `owner@demo-restaurant.local` / `Owner123!` (owns `demo-restaurant`,
  which `apps/web` points at by default via `VITE_RESTAURANT_SLUG`)
- Demo staff: `manager@demo-restaurant.local` / `staff@demo-restaurant.local` /
  `kitchen@demo-restaurant.local`, all `Staff123!`

To provision a real platform administrator in a production deployment, use
`PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... npm run bootstrap:platform-admin -w apps/api`
(`scripts/bootstrapPlatformAdmin.ts`) instead — it requires a real, explicitly-supplied credential
and never falls back to a default.

## Redis version (BullMQ requirement)

BullMQ requires **Redis >= 5.0** (the queue connection fails its internal version check
otherwise). `docker compose up` already provides a compatible Redis (`redis:7-alpine`) — the
"With Docker" path above needs no extra steps.

If you run Redis natively instead of via Docker (the "Without Docker" path), verify its version
first:
```
redis-cli info server | grep redis_version
```
A stale/incompatible Redis (for example the old, unmaintained MSOpenTech "Redis on Windows" port,
which tops out around 3.0.x) will make `notificationQueue.add(...)` reject with `"Redis version
needs to be greater or equal than 5.0.0"`. This is **caught and logged, not fatal** — order and
ticket events still emit over Socket.IO and the API/tests/E2E suite all still pass; only the
BullMQ job never gets enqueued (so the worker, which currently only logs jobs, never sees it).
Fix by pointing `REDIS_URL` at a real Redis 5+/6+/7 instance (Docker's `redis:7-alpine` is the
simplest) rather than an incompatible native install.

## Tests

```
npm run test:api      # Jest — unit + service/controller/integration tests
npm run test:e2e       # Playwright — requires apps/api/apps/web/apps/admin/apps/marketing all running
```

### Jest — isolated test database (Phase 46)

`apps/api/src/test-utils/fixtures.ts`'s helpers (`createTestRestaurant`, `createTestPlan`, etc.) create
real documents against whatever `MONGO_URI`/`REDIS_URL` the test run resolves to. Jest's own
`setupFiles` (`jest.setup.env.ts`) loads `.env` first, then re-applies `apps/api/.env.test` with
override — so **Jest always runs against `restaurant_platform_test` / Redis DB index 1**, never the
shared dev database `.env` points at, regardless of what a developer's own `.env` says. `.env.test`
carries no real secrets (only a database name and a Redis index) and is committed, so this is
zero-setup for every developer and CI.

This is what makes `npm run test:api` safe to run repeatedly without polluting the database the dev
servers and `GET /public/plans` read from — a stray `isActive:true`, empty-pricing `Plan` document
created by `createTestPlan()` (used by ~13 test files, several without their own cleanup) used to
land permanently in the shared dev database; it now lands in a database nothing else ever reads.
The isolated test database/Redis index are created automatically on first use (MongoDB/Redis both
create a database/logical DB lazily) — expect the very first test file that touches either after a
fresh isolation setup to take a few seconds longer than normal; every run after that is fast.

**If your local dev database predates Phase 46** (i.e. it's been running since before this file's
Jest isolation existed), it may still carry leftover `"Test Plan"` documents — and subscriptions
pointing at them — created back when Jest had no database of its own. Phase 46 makes this
structurally impossible going forward; it doesn't retroactively clean up what already landed there.
Run `npm run --workspace apps/api cleanup:test-plans` once to remove them
(`apps/api/src/scripts/cleanupOrphanedTestPlans.ts`) — it only ever touches documents named exactly
`"Test Plan"` (createTestPlan's own, unvarying fixture name — never a real commercial plan's name)
and is safe to re-run (a no-op once clean).

### Playwright — e2e order backlog (Phase 55)

Unlike Jest, the e2e suite runs against the real, running dev servers and the SAME shared dev
database — there's no equivalent "point it at its own database" fix available without standing up a
second full dev-server stack, a materially bigger change than this repo's e2e infrastructure
currently needs. Instead, every e2e spec already follows two universal, deterministic conventions
(true by inspection, never used by seed data or a real signup): a spec-created restaurant's slug
always starts with `e2e-`, and a spec-created user's email always ends in `@test.local`. Repeated
runs against the shared seeded `demo-restaurant` (reused by specs like `online-payment.spec.ts` that
need a fully-set-up, orderable restaurant rather than provisioning their own) accumulate real Order
documents there over time — confirmed as a genuine contributor to a real e2e timeout once volume
got large enough (Phase 55's Orders-page investigation).

Run `npm run --workspace apps/api cleanup:e2e-orders` periodically (`apps/api/src/scripts/
cleanupE2eOrders.ts`, logic in `services/e2eOrderCleanup.service.ts`) to remove them. It only ever
deletes `Order` documents — never a restaurant, business, or user — matching either marker above,
older than one hour (so a test suite running concurrently can't have its own in-progress order
pulled out from under it), and refuses to run at all under `NODE_ENV=production`. Safe to re-run.
Disposable e2e-created restaurants/businesses/users themselves are NOT cleaned up by this script —
see the script's own comment for why that's deliberately out of scope for now.

A handful of pre-existing tests (`agencyEntitlementInheritance.service.test.ts`) already guard with
`if (!plan) return` for "the real commercial catalog isn't present in this database" — under full
isolation that guard now always applies (the isolated database never has `npm run seed`'s catalog
unless a test creates it itself), so those specific bonus assertions consistently skip rather than
run. They were written to tolerate exactly this; nothing regresses.

`jest.config.js` also caps `maxWorkers` at 50% — this dev machine (and possibly yours) has few CPU
cores already busy running the dev servers; too many parallel Jest workers each opening their own
MongoDB connection at once was the repeated, reproducible cause of `beforeAll` hooks occasionally
exceeding their default 5000ms timeout under contention, not any real slowness in the code under
test. Raise it back on a beefier CI runner if full-suite wall-clock time matters more there.

### Playwright — full-suite login-throttle note (Phase 46)

Every Playwright spec that reaches an authenticated page calls `/auth/login` at least once, and
`authLimiter` (auth.routes.ts) is keyed by IP — so a full local run's aggregate login traffic (every
spec, from this one machine) can exceed the 30/15min throttle even though no single real client
ever would (confirmed live during Phase 46). If you hit `429`/"Too many requests" partway through a
full local run, set `AUTH_RATE_LIMIT_MAX=1000` (or similar) in `apps/api/.env` before starting the
dev API server — **never** in a real deployment; the default (30) is unchanged everywhere this
isn't explicitly overridden. This doesn't make individual specs more reliable by itself, only removes
a whole-suite-only failure mode; each spec still succeeds or fails on its own merits.

## Linting & formatting

```
npm run lint           # ESLint across api/web/admin, shared flat config in packages/config
npm run format          # Prettier, shared config in packages/config
```

## Production deployment requirements (Phase 15)

Beyond the JWT/Mongo/Redis basics above, a real deployment intending to accept real customers
needs to make two explicit decisions the dev/test defaults deliberately don't make for it:

- **Email**: set `EMAIL_PROVIDER=smtp` plus `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` and
  `EMAIL_FROM` (a real, deliverable address on a domain you control — never a placeholder like the
  `.local` addresses this repo's own seed/fixture data uses). `NODE_ENV=production` now **enforces**
  this at boot (`apps/api/src/config/env.ts`) rather than only documenting it: the server refuses to
  start if `EMAIL_PROVIDER` is still `console`, if `EMAIL_PROVIDER=smtp` is missing `SMTP_HOST`/
  `SMTP_PORT`/`EMAIL_FROM`, or if `CLIENT_ORIGIN`/`ADMIN_ORIGIN` are still their localhost dev
  defaults — every verification/reset/invite email link is built from those two origins, so a
  forgotten override there means real recipients click a link to someone's own laptop. Leaving
  `EMAIL_PROVIDER` unset (the default, `console`) means owner-signup verification, password-reset,
  staff/owner-invite, order, and trial-reminder emails are only ever logged server-side, never
  actually delivered — fine for local dev (and required for this repo's own tests), not survivable in
  production; owner self-serve signup (`POST /businesses/self-serve`) specifically **requires** a
  verified email before it will create a business at all, so this isn't optional the way cash-only
  payments are. See `apps/api/src/email/SmtpEmailService.ts` — real code, but never exercised against
  a live mailbox in this environment; test a real send before depending on it.
- **Payments**: leaving `PAYMENT_PROVIDER` unset (the default, `mock`) means no real money ever
  moves — customers can still order and pay with cash, but "Pay online" would be backed by fake
  money. Setting `PAYMENT_PROVIDER=safepay` (plus `SAFEPAY_API_KEY`/`SAFEPAY_SECRET_KEY`/
  `SAFEPAY_WEBHOOK_SECRET`/`SAFEPAY_ENV=production`) switches to real, network-capable Safepay
  code — but see `docs/payment-provider-decision.md`'s Phase 15 update: it has never been run
  against a live Safepay account, and specific pieces (the webhook signature header name, the
  refund endpoint) are documented assumptions, not verified facts. Verify against Safepay's real
  sandbox before enabling this anywhere real money could move. Cash-only launch remains fully
  supported indefinitely — online payment is a restaurant-level opt-in
  (`Restaurant.settings.onlinePaymentEnabled`), never a requirement.
