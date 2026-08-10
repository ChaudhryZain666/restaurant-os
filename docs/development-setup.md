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
docker compose exec api npm run seed -w apps/api
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
npm run seed -w apps/api

npm run dev:api      # http://localhost:4000
npm run dev:web       # http://localhost:5173 (customer storefront)
npm run dev:admin     # http://localhost:5174 (restaurant/platform admin)
```

Seeded accounts (from `npm run seed`):
- Platform admin: `platform-admin@restaurant.local` / `Admin123!`
- Demo restaurant owner: `owner@demo-restaurant.local` / `Owner123!` (owns `demo-restaurant`,
  which `apps/web` points at by default via `VITE_RESTAURANT_SLUG`)

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
