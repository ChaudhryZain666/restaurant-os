# Restaurant Platform

A multi-tenant restaurant online ordering SaaS platform with an integrated customer CRM. Built
for many restaurants on one platform, not one app per restaurant — see `docs/architecture.md`
for what that means in practice.

## Stack

- **Backend:** Node.js, Express, TypeScript, MongoDB (Mongoose), Redis (ioredis), BullMQ, Socket.IO
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, React Hook Form, Zod, React Router
- **Auth:** JWT access tokens (15m) + Redis-backed rotating refresh tokens (30d, httpOnly cookie, revocable), 6-role RBAC
- **Docs:** Swagger UI at `/api/docs`, generated from `docs/openapi.yaml`

## Repo layout

```
apps/
  api/      Express API — all business logic, all tenants
  web/      Customer storefront (React + Vite)
  admin/    Restaurant dashboard + platform admin (React + Vite, role-gated routes)
packages/
  types/        Shared TypeScript types + RBAC role→permission table
  validation/   Shared zod schemas (API validation + future frontend forms)
  utils/        Shared browser API client
  config/       Shared tsconfig/ESLint/Prettier config
  ui/           Shared UI components
infrastructure/
  docker/       Dockerfiles for api/web/admin
docs/           Architecture, database, auth, API, dev setup, roadmap
e2e/            Playwright end-to-end tests
```

Full setup instructions: **[docs/development-setup.md](docs/development-setup.md)**.
Why things are built this way: **[docs/architecture.md](docs/architecture.md)**.

## Quick start (Docker)

```
cp .env.example .env
docker compose up -d --build
docker compose exec api npm run seed -w apps/api
```
- Storefront: http://localhost:5173
- Admin: http://localhost:5174
- API: http://localhost:4000 · Docs: http://localhost:4000/api/docs

Seeded accounts: `platform-admin@restaurant.local` / `Admin123!` and
`owner@demo-restaurant.local` / `Owner123!` (owns the seeded `demo-restaurant`).

## Status

- **Ordering + loyalty core** (menu, cart, checkout, orders, loyalty points/tiers) — built and
  smoke-tested end-to-end via the API before this platform foundation work; **not yet re-tested
  in the browser** against the new tenant-scoped routes since the restructure.
- **Platform foundation** (multi-tenancy, RBAC, versioned API, Swagger, structured logging,
  BullMQ/Socket.IO/storage scaffolding, Docker, tests, docs) — this phase's work; see
  `docs/roadmap.md` for exactly what is and isn't built yet.
