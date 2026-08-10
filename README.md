# Restaurant Online Ordering Platform

A restaurant ordering platform with an integrated customer CRM (loyalty program first, then support/segmentation/campaigns).

## Stack

- **Backend:** Node.js, Express, TypeScript, MongoDB (Mongoose), Redis (ioredis)
- **Frontend:** React, TypeScript, Vite, React Router
- **Shared:** `@restaurant/shared` — types shared between client and server
- **Auth:** Custom JWT access tokens (15m) + Redis-backed refresh tokens (30d, httpOnly cookie, rotated on use, revocable)

## Repo layout

```
apps/
  server/   Express API
  client/   React app (Vite)
packages/
  shared/   Shared TypeScript types (User, MenuItem, Order, Loyalty)
docker-compose.yml   MongoDB + Redis for local dev
```

## Getting started

1. Start MongoDB and Redis:
   ```
   docker compose up -d
   ```
   MongoDB runs as a single-node replica set (`rs0`, auto-initiated by the healthcheck) because order
   creation uses a multi-document transaction (order + loyalty ledger together) — transactions require
   a replica set even for local dev. If you run MongoDB outside Docker, start `mongod --replSet rs0` and
   initiate it yourself (`mongosh --eval "rs.initiate()"`), or order creation will fail with
   `Transaction numbers are only allowed on a replica set member or mongos`.
2. Install dependencies (from repo root):
   ```
   npm install
   ```
3. Copy `apps/server/.env.example` to `apps/server/.env` and fill in real secrets (a `.env` with generated dev secrets is already included locally and gitignored).
4. Build the shared package once (server/client both depend on its compiled output):
   ```
   npm run build:shared
   ```
5. Seed an admin user and sample menu:
   ```
   npm run seed -w apps/server
   ```
6. Run both apps in separate terminals:
   ```
   npm run dev:server
   npm run dev:client
   ```
   Server: http://localhost:4000 · Client: http://localhost:5173 (proxies `/api` to the server)

Seeded admin login: `admin@restaurant.local` / `Admin123!`

## MVP scope (phase 1)

- Menu browsing (Redis-cached, 60s TTL, invalidated on writes)
- Cart → checkout → order creation (Mongo transaction covers order + loyalty ledger together)
- Customer accounts (JWT auth, roles: customer/staff/admin)
- Loyalty: points earned per order, redeemable, tier calculated from balance
- Order status tracking, staff/admin can update status

## Planned next phases (CRM layer)

- Customer 360 view for staff/admin (order history, lifetime value, loyalty tier)
- Segmentation (e.g. "customers who haven't ordered in 30 days")
- Campaigns / promotions targeting segments
- Support ticket thread per customer
- Analytics dashboard (revenue, repeat-order rate, popular items)

Build phase 1 end-to-end and validate it against real usage before starting the CRM layer — that sequencing is deliberate, not a placeholder.
