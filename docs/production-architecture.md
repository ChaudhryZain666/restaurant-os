# Production Architecture

Phase 85A. This is the production hostname and routing contract for GarnishTable, and the
packaging that implements it. It describes the code as it stands; nothing here has been provisioned
yet (see the Phase 85A report for what remains).

## 1. Hostname contract

| Surface | Production origin | Served by | Env (API) |
|---|---|---|---|
| Marketing | `https://garnishtable.com` | `apps/marketing` build | `MARKETING_ORIGIN` |
| Owner Portal | `https://app.garnishtable.com` | `apps/admin` build | `ADMIN_ORIGIN` |
| Agency Portal | `https://agency.garnishtable.com` | `apps/admin` build (same) | `PORTAL_ORIGINS` |
| Platform Admin | `https://admin.garnishtable.com` | `apps/admin` build (same) | `PORTAL_ORIGINS` |
| POS | `https://pos.garnishtable.com` | `apps/admin` build (same) | `PORTAL_ORIGINS` |
| Customer Storefront | `https://order.garnishtable.com` | `apps/web` build | `CLIENT_ORIGIN` |
| API, Socket.IO, background worker | `https://api.garnishtable.com` | `apps/api` | `API_PUBLIC_ORIGIN` |

```env
CLIENT_ORIGIN=https://order.garnishtable.com
ADMIN_ORIGIN=https://app.garnishtable.com
MARKETING_ORIGIN=https://garnishtable.com
API_PUBLIC_ORIGIN=https://api.garnishtable.com
PORTAL_ORIGINS=https://agency.garnishtable.com,https://admin.garnishtable.com,https://pos.garnishtable.com
```

The full template, with every production variable, is `apps/api/.env.production.example`.

### One admin build, four portals

Owner Portal, Agency Portal, Platform Admin and POS are **role-based experiences inside one
application** (`apps/admin`). Every route (`/`, `/agency/*`, `/platform/*`, `/pos/*`) exists on all
four hostnames, and what a user can open is decided by their role and permissions (`RequireAuth`),
never by the hostname. The hostname only changes where `/` lands:

- `agency.` — agency users already land on `/agency` by role.
- `admin.` — platform admins already land on `/platform` by role.
- `pos.` — users who can operate the POS (`restaurant.pos.operate`) land on `/pos` instead of the
  owner dashboard (`apps/admin/src/lib/portalHosts.ts`, driven by `VITE_POS_URL`).

POS is a separate operational surface (its own shell, `POSLayout`, built for counter tablets) that
happens to ship in the same build.

**Sessions are per hostname.** The refresh cookie is set on whichever hostname the user signs in on
(the API is reached through that hostname's `/api` proxy), so signing in on `app.` doesn't sign you
in on `pos.`. That's the intended isolation for a shared counter device.

**Email links** (invites, password resets, verification) are built from `ADMIN_ORIGIN`
(`app.garnishtable.com`). That works for every role because every route exists on every portal
hostname.

### Customer custom domains are separate

Restaurants' own domains (e.g. `orders.somerestaurant.com`) are tenant data (`DomainMapping`), not
part of this contract. They're served by the storefront build. Their infrastructure requirements
(DNS target, edge routing, on-demand TLS) are in `docs/custom-domains-infrastructure-contract.md`.

## 2. Request routing (the edge)

All three frontends call the API at the **relative** path `/api/v1` (`createApiClient({ basePath:
"/api/v1" })`, `credentials: "include"`). So every frontend hostname, **including every customer
custom domain**, must forward `/api/*` to the API. Only Socket.IO connects cross-origin, to
`VITE_API_URL` (`https://api.garnishtable.com`).

The edge (TLS terminator / reverse proxy / CDN) must:

1. Terminate TLS for all seven hostnames (and later, customer custom domains).
2. On every frontend hostname, forward `/api/*` to the API, preserving the path.
3. On storefront hostnames, forward `/sitemap.xml` to the API (it's generated from live data).
4. On `api.garnishtable.com`, forward everything, with **WebSocket upgrade** enabled
   (`Upgrade`/`Connection` headers) for Socket.IO. Socket.IO tries long-polling first, then upgrades.
5. Allow request bodies of at least **100 MB** on `/api` (menu import: up to 12 × 8 MB images or a
   15 MB PDF in one multipart request).
6. Serve each single-page app with an `index.html` fallback for unknown paths.
7. Append the real client address to `X-Forwarded-For`.

`infrastructure/docker/nginx/frontend.conf.template` implements 2, 3, 5 and 6 for a frontend
container. TLS (1) and the `api.` WebSocket upgrade (4) belong to the edge in front of it.

**Phase 86: the production edge is Caddy**, in `infrastructure/production/`:
- `Caddyfile`: the seven fixed hostnames, plus on-demand TLS for restaurant custom domains, gated
  by the API's private certificate-issuance check.
- `docker-compose.yml`: Caddy is the only service publishing ports (80/443). The API, frontends and
  optional Redis sit on private networks; Caddy's certificate state persists in a volume.

Operations and the custom-domain lifecycle are in `docs/custom-domains-operations.md`. With this
stack, `TRUST_PROXY` is the fixed private edge subnet (`GT_EDGE_SUBNET`), set by Compose.

### Trust model for client IPs (`TRUST_PROXY`)

Every rate limiter (auth, signup, contact, invites, the global limiter) keys on `req.ip`. Behind a
proxy, `req.ip` is only correct if Express knows which hops to trust (`src/config/trustProxy.ts`):

- **Preferred:** the proxies' address range, e.g. `TRUST_PROXY=10.0.0.0/8`. `X-Forwarded-For` is only
  honoured on connections that actually come from those addresses, so a caller who reaches the API
  port directly can't forge its IP.
- **Hop count**, e.g. `TRUST_PROXY=2` for edge → frontend nginx → API, or `1` when the edge talks to
  the API directly. Only safe when nothing can reach the API except through those proxies.
- `TRUST_PROXY=true` (trust everything) is refused at boot: the client writes the leftmost
  `X-Forwarded-For` entry itself and could pick a fresh rate-limit bucket per request.
- Production refuses to boot without an explicit value (`none` is allowed if nothing proxies the API).

Covered by `src/config/trustProxy.test.ts`: direct requests, requests through the trusted proxy,
spoofed `X-Forwarded-For` entries, a caller bypassing the proxy, and per-client rate-limit buckets.

### CORS and Socket.IO origins

- HTTP CORS allows `CLIENT_ORIGIN`, `ADMIN_ORIGIN`, `MARKETING_ORIGIN` and every `PORTAL_ORIGINS`
  entry (`src/config/origins.ts`). With the same-origin `/api` proxy, browsers rarely need it.
- Socket.IO allows the storefront, all four portals, and any **active** custom domain over https
  (`src/realtime/realtimeOrigins.ts`, looked up in `DomainMapping`, cached for 60s). Sockets are
  authenticated by the handshake token, not cookies.

## 3. The API is a single instance

Run exactly **one** API process. It runs the HTTP server, Socket.IO, the BullMQ notification worker,
and the repeatable jobs (trial reminders, trial expiry, payment reconciliation, marketplace
stuck-event checks, menu-import cleanup) in-process (`src/index.ts`). Two instances would be wrong:

- Socket.IO has no Redis adapter, so an event emitted on one instance never reaches sockets
  connected to another.
- Running the worker separately from HTTP would be a code change.

Sizing estimate: about 1 vCPU and 1–2 GB RAM, because menu-import uploads are held in memory. It
needs no persistent disk: all state is in MongoDB, Redis or object storage.

Health: `GET /health/live` is liveness (process up); `GET /health` is readiness (MongoDB and Redis
reachable, 503 when degraded). Graceful shutdown on SIGTERM is bounded at 10s, so give the
supervisor a stop timeout of at least 15s.

## 4. Packaging: build and start

The development Dockerfiles (`infrastructure/docker/{api,web,admin}.Dockerfile`, used by
`docker-compose.yml`) run `tsx watch` and Vite dev servers. They are **never** for production.

### API

```sh
npm ci
npm run build:packages            # packages/types, validation, utils → dist/
npm run build -w apps/api         # tsc → apps/api/dist/
cd apps/api && NODE_ENV=production node dist/index.js
```

Image: `infrastructure/docker/api.prod.Dockerfile` (multi-stage; runtime has no dev dependencies;
runs as the `node` user; healthcheck on `/health/live`; `CMD ["node", "dist/index.js"]`).

**Deploy steps.** Phase 87: `infrastructure/production/scripts/deploy.sh` runs the per-deploy
steps itself (indexes on every deploy; `--init` adds the plan seed and demo storefront) in a one-off
container of the new image, and the demo cleanup is an in-process scheduled job. See
`docs/production-deployment-runbook.md`. The underlying commands, run from `apps/api` with the
compiled scripts since `tsx` is a dev dependency:

| When | Command |
|---|---|
| Every deploy, before traffic | `node dist/scripts/ensureIndexes.js` (production doesn't auto-build indexes) |
| First deploy, then whenever plans change | `node dist/scripts/seed.js` (plan catalog, idempotent) |
| Once | `node dist/scripts/bootstrapPlatformAdmin.js` (with `PLATFORM_ADMIN_EMAIL`/`PASSWORD` set) |
| First deploy (idempotent, safe to repeat) | `node dist/scripts/provisionProductionDemo.js` (marketing demo storefront) |
| Automatic, hourly (BullMQ `demo.cleanup_tick`, Phase 87) | same logic as `node dist/scripts/cleanupDemoData.js` (expired public-demo guest accounts and their orders), which remains for manual runs |

Never run `seed-demo-data.ts` against production: it creates known-password accounts and fake
orders.

### Frontends

Each is a static Vite build (`dist/`) with an `index.html` SPA fallback.

| App | Build | Serves | Required build variables |
|---|---|---|---|
| `apps/web` | `npm run build:packages && npm run build -w apps/web` | `order.` and customer custom domains | `VITE_API_URL`, `VITE_SITE_URL`, `VITE_ADMIN_URL`, `VITE_MARKETING_URL` |
| `apps/admin` | `npm run build:packages && npm run build -w apps/admin` | `app.`, `agency.`, `admin.`, `pos.` | `VITE_API_URL`, `VITE_STOREFRONT_URL`, `VITE_MARKETING_URL`, `VITE_POS_URL`, `VITE_AGENCY_URL`, `VITE_PLATFORM_ADMIN_URL` |
| `apps/marketing` | `npm run build:packages && npm run build -w apps/marketing` | apex | `VITE_SITE_URL`, `VITE_STOREFRONT_URL`, `VITE_ADMIN_URL` |

`VITE_*` values are compiled into the bundle, so each environment needs its own build. Build from a
clean checkout, or from the Docker image, whose `.dockerignore` excludes them: Vite also reads
`apps/*/.env` files, and a developer's local file can silently add values the production
environment doesn't set. Phase 85B found exactly this: a local `VITE_RESTAURANT_SLUG=demo-restaurant`
made every unmapped hostname redirect to the demo restaurant. Leave `VITE_RESTAURANT_SLUG` unset in
production. Image:
`infrastructure/docker/frontend.prod.Dockerfile --build-arg APP=web|admin|marketing`. It fails the
build when a required variable is missing or points at localhost
(`infrastructure/docker/check-build-env.sh`), then serves the build with nginx using
`nginx/frontend.conf.template`. `API_UPSTREAM` (default `http://api:4000`) is where that nginx
forwards `/api`.

Production values:

```env
# apps/web
VITE_API_URL=https://api.garnishtable.com
VITE_SITE_URL=https://order.garnishtable.com
VITE_ADMIN_URL=https://app.garnishtable.com
VITE_MARKETING_URL=https://garnishtable.com
# apps/admin
VITE_API_URL=https://api.garnishtable.com
VITE_STOREFRONT_URL=https://order.garnishtable.com
VITE_MARKETING_URL=https://garnishtable.com
VITE_POS_URL=https://pos.garnishtable.com
VITE_AGENCY_URL=https://agency.garnishtable.com
VITE_PLATFORM_ADMIN_URL=https://admin.garnishtable.com
# apps/marketing
VITE_SITE_URL=https://garnishtable.com
VITE_STOREFRONT_URL=https://order.garnishtable.com
VITE_ADMIN_URL=https://app.garnishtable.com
```

## 5. Production fail-closed rules

These hold regardless of other configuration (`src/config/env.ts`, `src/config/mockDrivers.ts`).

**The API refuses to boot in production when:**

- the email provider isn't SMTP, or SMTP host, port or `EMAIL_FROM` is missing;
- any origin (including `PORTAL_ORIGINS`) is still localhost;
- `TRUST_PROXY` is unset, or set to "trust everything";
- `POS_TERMINAL_PROVIDER=mock`;
- `BILLING_PROVIDER=paddle` without `PADDLE_ENV=production`, without all three Paddle credentials,
  or with a sandbox (`test_`) client token;
- Redis is below 5.0.0. It also warns below 6.2.

**Mock drivers are refused at request time** (404 or a clear error) in production:

- mock payment completion, and the mock payment webhook;
- online payment through the mock provider, including an owner switching online payments on;
- mock billing checkout, its completion and advance routes, and the mock billing webhook;
- the mock marketplace webhook;
- mock terminal completion.

A cash-only (`PAYMENT_PROVIDER=mock`) or pre-Paddle (`BILLING_PROVIDER=mock`) production deployment
is therefore safe. Cash orders and trials work, and nothing can be marked paid without real money.

**Paddle.js** is initialised for the environment named in the API's checkout response. The admin
app never defaults to sandbox, and rejects a token from the other environment
(`apps/admin/src/lib/paddleEnvironment.ts`).

## 6. Known constraints

- **Anthropic model.** Keep `ANTHROPIC_MODEL=claude-sonnet-4-5` (active, working). The extractor
  forces `tool_choice: { type: "tool" }`; newer models such as Opus 5.5 and Sonnet 5.5 reject forced
  tool choice, so changing the model needs a code change in `ClaudeMenuExtractionProvider.ts` first.
- **Scaling** past one API instance needs a Socket.IO Redis adapter and a separate worker process.
