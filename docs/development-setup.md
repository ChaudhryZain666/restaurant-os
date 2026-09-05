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
npm run test:api      # Jest — unit tests (RBAC/tenant middleware, TTL parsing) + envelope/route tests, no DB required
npm run test:e2e       # Playwright — requires apps/web running at http://localhost:5173
```

## Linting & formatting

```
npm run lint           # ESLint across api/web/admin, shared flat config in packages/config
npm run format          # Prettier, shared config in packages/config
```

## Production deployment requirements (Phase 15)

Beyond the JWT/Mongo/Redis basics above, a real deployment intending to accept real customers
needs to make two explicit decisions the dev/test defaults deliberately don't make for it:

- **Email**: set `EMAIL_PROVIDER=smtp` plus `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD` and
  `EMAIL_FROM`. Leaving `EMAIL_PROVIDER` unset (the default, `console`) means owner-invite,
  password-reset, and email-change-verification emails are only ever logged server-side, never
  actually delivered — fine for local dev, not survivable in production. See
  `apps/api/src/email/SmtpEmailService.ts` — real code, but never exercised against a live mailbox
  in this environment; test a real send before depending on it.
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
