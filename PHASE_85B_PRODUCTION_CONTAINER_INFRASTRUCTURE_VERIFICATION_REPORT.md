# Phase 85B — Production Container & Infrastructure Verification

Baseline: Phase 85A's working tree (uncommitted) on top of `6ee44cf`. Nothing in this phase was
committed or pushed, and no production service was connected.

## 1. Executive Status

**`PARTIAL — BLOCKED BY LOCAL ENVIRONMENT`**

**Docker is not installed on this machine**, and neither are Podman, nerdctl or a WSL distribution.
So none of the four production images (`api.prod.Dockerfile`, and `frontend.prod.Dockerfile` with
`APP=web|admin|marketing`) was built or started, and the nginx configuration was never executed.
Those items stay **BLOCKED — Docker is not installed/available on this machine.**

Everything the images *contain* was verified natively, as close to the image as this machine allows:

- **API runtime:** reconstructed from the Dockerfile's own COPY list, with a production-only
  dependency install. The compiled API ran with `NODE_ENV=production` against **Redis 8.10.1** and
  a disposable MongoDB 8.3.4 replica-set database.
- **Frontends:** the three production builds, made with the production `VITE_*` values.
- **Hostnames and browser:** all seven production hostnames, served over HTTPS through a scratch
  edge implementing the documented routing rules, driven by a real Chromium browser.
- **Worker:** processed real and synthetic jobs on Redis 8.10.1.

This is **not** a claim that the project is production ready, or that the images work.

## 2. Environment

| Item | Found |
|---|---|
| OS | Windows 11 Home 10.0.22631 |
| Node.js | v24.18.0. The images pin `node:22-slim`, so the runtime major version differs from the image. |
| Package manager | npm 11.16.0 (repo uses npm workspaces + `package-lock.json`). npm 11 blocks dependency install scripts by default; `node:22-slim` ships npm 10, which doesn't. |
| Docker / Compose / buildx | **Not installed** (`docker: command not found`; no `C:\Program Files\Docker`) |
| Podman / nerdctl / WSL distro | Not installed / none |
| MongoDB | 8.3.4, Windows service, replica set `rs0`, `localhost:27017` |
| Redis (dev) | 3.0.504, Windows service, `:6379`. Below BullMQ's minimum; **not used** for worker verification. |
| Redis (6.2+) | **8.10.1** (winget `redis-windows-fork`), already running on `:6380`. Disposable **db 14** used: empty before, flushed after. db0's existing 1,694 keys untouched. |
| nginx | Not installed |
| openssl | 3.5.7 (used only for a throwaway self-signed test certificate, deleted afterwards) |
| Ports | 80, 443, 4100, 8080 free; 4000/5173/5175 (running dev servers), 6379, 6380 and 27017 in use |
| Env files present | `.env` and `.env.production` in `apps/api`, `.env` in `apps/web` and `apps/admin`. Contents were not printed. **None were used** by the production run: it loaded only a scratch env file (outside the repo) through `DOTENV_CONFIG_PATH`, with freshly generated, never-printed throwaway JWT secrets, deleted afterwards. |

## 3. Docker Verification

| Artifact | Build | Started | Smoke Tested | Result |
|---|---|---|---|---|
| API (`api.prod.Dockerfile`) | ❌ not run — no Docker | ❌ | ✅ natively, as an image-equivalent runtime | **BLOCKED** (image); runtime contents verified |
| Owner Portal (`frontend.prod.Dockerfile APP=admin`) | ❌ not run | ❌ | ✅ production build served on app./agency./admin./pos. | **BLOCKED** (image); build verified |
| Storefront (`APP=web`) | ❌ not run | ❌ | ✅ production build on order. and a custom domain | **BLOCKED** (image); build verified |
| Marketing (`APP=marketing`) | ❌ not run | ❌ | ✅ production build on the apex | **BLOCKED** (image); build verified |
| Worker | n/a: runs inside the API process (no separate image, by design) | ✅ with the API | ✅ on Redis 8.10.1 | **VERIFIED natively** |

**Image-equivalent API runtime.** Built in the scratchpad, outside the repo:

1. Copied the root manifest, lockfile and every workspace `package.json`.
2. Ran `npm ci --omit=dev` (exit 0, 419 s).
3. Copied exactly the Dockerfile's runtime files: `packages/types` and `packages/validation`
   (`package.json` + `dist`), `apps/api` (`package.json` + `dist`), and `docs/openapi.yaml`.
4. Ran `node dist/index.js` from `apps/api`, as the image's `CMD` does.

`check-build-env.sh` was run before every frontend build.

| Frontend | Build | Duration | Output | Warnings |
|---|---|---|---|---|
| Storefront | exit 0 | 14 s | 8.0 MB | 1 (Vite chunk-size advisory) |
| Owner Portal | exit 0 | 25 s | 8.2 MB | 1 (Vite chunk-size advisory) |
| Marketing | exit 0 | 13 s | 1.9 MB | none |

## 4. Production Configuration Verification

All cases ran in the image-equivalent runtime (`node dist/index.js`, `NODE_ENV=production`). Each
case is the valid configuration with exactly one thing broken.

| Case | Result |
|---|---|
| Missing origin (`CLIENT_ORIGIN` falls back to localhost) | exit 1, `CLIENT_ORIGIN` rejected |
| Missing `JWT_ACCESS_SECRET` | exit 1, `JWT_ACCESS_SECRET: Required` |
| Unsafe (short) `JWT_REFRESH_SECRET` | exit 1, rejected |
| Missing `TRUST_PROXY` | exit 1, rejected |
| `TRUST_PROXY=true` | exit 1, rejected |
| Paddle on sandbox in production (`PADDLE_ENV=sandbox`, `test_` token) | exit 1, `PADDLE_ENV` and `PADDLE_CLIENT_TOKEN` rejected |
| Paddle production missing credentials | exit 1, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_CLIENT_TOKEN` rejected |
| `POS_TERMINAL_PROVIDER=mock` | exit 1, rejected |
| `EMAIL_PROVIDER=console` | exit 1, rejected |
| Localhost portal origin | exit 1, `PORTAL_ORIGINS` rejected |
| Redis 3.0.504 | exit 1, "Production requires Redis >= 5.0.0 … Refusing to start." (3.8 s; the first, cold attempt exceeded a 25 s test window) |

Runtime guards, against the **running** production API through the edge:

| Attempt | Result |
|---|---|
| Owner enables online payments with no payment account (mock pooled provider) | 400 "Connect a payment account before enabling online payments." |
| Customer starts an online payment on a legacy online order (online payments forced on in the DB beforehand) | 400 "…please pay with cash." No payment created; order stays `unpaid` |
| Mock payment completion route | 404 (not registered) |
| Mock payment webhook | 404 |
| Mock billing webhook | 404 |
| Mock checkout completion | 404 (not registered) |
| Mock subscription advance | 404 (not registered) |
| Paid-plan checkout via the mock billing provider | 503 "Paid plan checkout isn't available yet…" |
| Mock marketplace webhook (`uber_eats`) | 404 |
| Mock POS terminal completion | 404 (not registered) |

After all attempts, the database held 0 payments, 0 subscriptions and 0 paid orders.

## 5. API Verification

Image-equivalent runtime, `NODE_ENV=production`, `PORT=4100`, Redis 8.10.1 (db 14), MongoDB
`garnishtable_85b_smoke`.

- **Startup:** connected to Mongo and Redis, "server listening". The only warnings were the two
  intended mock-provider production warnings (payments, billing). No errors.
- **Liveness:** `GET /health/live` 200.
- **Readiness:** `GET /health` 200, `{"mongo":"up","redis":"up"}`.
- **Ordinary requests:** `GET /api/v1/public/plans` 200; `/api/docs/` 200 (reads `../../docs/openapi.yaml`,
  confirming the Dockerfile's copy of that file is needed and correctly placed).
- **No development behaviour:** the dev-only `/local-storage` route returns 404.
- **Deploy steps from the compiled scripts:**
  - `ensureIndexes.js` exit 0;
  - `seed.js` exit 0 (plan catalog, no accounts);
  - `provisionProductionDemo.js` exit 0 (see §9).
- **Real client IP behind the edge:** rate-limit buckets were separate per forwarded client IP
  (999 → 998 for the same IP, 999 for a different one).
- **Graceful shutdown: NOT VERIFIED.** Windows can't deliver SIGTERM to a native Node process
  (only a forced kill is possible), so the in-container SIGTERM path still needs a Docker run.
  The shutdown sequence is unit-tested (`shutdown.test.ts`).

## 6. Worker Verification

| | Result |
|---|---|
| Redis | **8.10.1** (`redis://127.0.0.1:6380/14`) |
| Version check | passed silently: no "< 6.2" warning, no refusal |
| Connection | `[queue] redis ready` |
| Queue registration | `notifications` queue; **5 repeatable schedules** registered |
| Real jobs | 4 × `order.created` (from the smoke orders) completed. Repeatable ticks fired on their own: `marketplace.stuck_event_check` ×6, `payment.reconciliation_tick` ×1, `billing.trial_expiration_tick` ×1 |
| Totals | **13 completed, 0 failed** before the failure test |
| Failure path | Enqueued `delivery.dispatch_create` with non-existent order/restaurant IDs, `attempts: 1` → **failed: "Order not found"**. The state is `failed`, the worker's `failed` handler logged it, and the API stayed healthy (`/health` 200). |
| Email behaviour | 2 "order notification email failed" lines, for the 2 real orders (dead SMTP port, by design: nothing can leave the machine). **0** for the 2 demo orders, confirming Phase 85A's demo-order email suppression in production. |

## 7. Frontend Verification

Served by the scratch edge on `https://<real hostname>:443`, reached by Chromium through
`--host-resolver-rules`. Production builds only; no dev server.

**Marketing (`garnishtable.com`)**
- Homepage loads (title "GarnishTable — Online Ordering for Independent Restaurants") with
  0 failed requests, 0 console errors and 0 localhost requests.
- `robots.txt` → `Sitemap: https://garnishtable.com/sitemap.xml`; `sitemap.xml` `<loc>`s use the
  production origin; `og:image` → `https://garnishtable.com/og-image.png`.
- The `/demo` page's link goes to `https://order.garnishtable.com/r/demo-restaurant/experience`,
  and following it loads the live playground. The homepage's embedded preview iframe also points
  at `https://order.garnishtable.com/r/demo-restaurant`.

**Owner Portal (`app.garnishtable.com`)**
- Loads with SPA fallback (deep links → `index.html`, `no-cache`); assets are cached as immutable,
  and a missing asset 404s.
- Sign-in works; "Wildwood Kitchen" is visible.
- The real order appears in Orders, and the demo order stays hidden from staff.
- Socket.IO connected to `api.garnishtable.com`. 0 localhost requests.

**Storefront (`order.garnishtable.com`)**
- **Demo path:** playground → demo guest session → cash checkout → `ORD-1001` / `ORD-1003`.
- **Real path:** registered customer → browse menu → add item → cash pickup → `ORD-1002` / `ORD-1004`.
- The API received every request: orders are in the DB and their jobs were processed.
- Socket.IO connected to `api.garnishtable.com` through the edge's WebSocket upgrade.
- `robots.txt` → `Sitemap: https://order.garnishtable.com/sitemap.xml`; `/sitemap.xml` is proxied
  to the API.

The only failed requests on any surface were benign, existing behaviour:
- `401 /api/v1/auth/refresh`: the normal "no session yet" probe on first load.
- `404 /api/v1/restaurants/by-domain/order.garnishtable.com`: the storefront's custom-domain lookup
  for its own platform hostname, which it handles silently.

## 8. Seven-Hostname Verification

| Hostname | Result |
|---|---|
| `garnishtable.com` | Marketing build. HTTP CORS allowed; Socket.IO correctly not allowed. |
| `app.garnishtable.com` | Admin build. Sign-in lands on `/` (dashboard). CORS and Socket.IO allowed. |
| `agency.garnishtable.com` | Same admin build (login page served). CORS and Socket.IO allowed. |
| `admin.garnishtable.com` | Same admin build (login page served). CORS and Socket.IO allowed. |
| `pos.garnishtable.com` | Same admin build. Visiting `/` → login → **lands on `/pos`** with the register loaded. CORS and Socket.IO allowed. |
| `order.garnishtable.com` | Storefront build; ordering, realtime and sitemap work. |
| `api.garnishtable.com` | API, health, and Socket.IO with WebSocket upgrade. |
| Customer custom domain (`orders.wildwood-test.example`) | **Unmapped:** storefront build with the honest "This link doesn't specify a restaurant" message (after the fix in §13). **Active** (disposable mapping + trialing Growth plan): Wildwood Kitchen renders, canonical is `https://orders.wildwood-test.example`, "Powered by" is hidden, and Socket.IO allows that https origin but not its plain-http variant. |
| Disallowed origins (`https://evil.example`, `http://localhost:5174`) | No `Access-Control-Allow-Origin` for HTTP or Socket.IO |

**Auth and cookies.** The refresh cookie is `HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth`,
host-only on the hostname the user signed in on, so each portal keeps its own session as
documented. Marketing → storefront is same-site (`garnishtable.com`), so the embedded demo isn't
affected by third-party-cookie blocking.

**Not verified:**
- **DNS and real certificates:** no DNS was created; the test certificate was self-signed.
- **The nginx rules themselves:** emulated by the scratch edge, not executed.

## 9. Demo Provisioning Verification

Ran `node dist/scripts/provisionProductionDemo.js` in the image-equivalent runtime against
disposable databases.

| Check | Result |
|---|---|
| Created when absent | ✅ 1 owner placeholder, 1 business, Wildwood Kitchen `demo-restaurant`, 7 categories, 28 items, 11 modifier groups, **0 orders** |
| Slug | `demo-restaurant` ✅ |
| Storefront data complete | ✅ menu, modifiers, cover, logo and cinematic theme all render, and ordering works |
| Safe re-run | ✅ second run: `{"owner":false,…,"modifierGroups":0}` |
| No duplicates | ✅ |
| Real restaurant owning the slug | ✅ refused, exit 1, "Nothing was changed". The foreign restaurant was untouched (0 categories, 0 users added). |
| Email addresses | The only account created is `demo-owner@demo-restaurant.garnishtable.invalid`: the deliberate, undeliverable owner placeholder (reserved `.invalid` TLD, random never-printed password). No customer or guest addresses, and nothing is ever emailed to it. |
| Unsafe production behaviour | None: online payments off; no staff, orders, tickets or platform accounts |

## 10. Security / Production Hygiene

- **Frontend builds:**
  - 0 source maps, 0 `.env` files, 0 secret-shaped strings (Stripe/Paddle/JWT/Mongo/Anthropic
    patterns), 0 Vite dev-client references.
  - The only `localhost` strings are benign: Socket.IO's client-library hostname fallback, and the
    admin printer-bridge field's placeholder `http://localhost:9100` (a device-local print bridge).
    No localhost API or app URL is baked in.
- **API runtime:**
  - no `.env` files; no test files in `dist`; `tsx`, Jest and Vite absent.
  - `dist` includes `.js.map` server source maps (no secrets).
  - **`typescript` and `eslint` are present** (see §13, issue 3).
  - `node_modules` is 177 MB.
- **Secrets at runtime:** passed via env at run time only. The image bakes none (`.dockerignore`
  excludes `**/.env*`), and the production run never touched the repo's `.env` files.
- **Mock providers:** all refused in production (§4).
- **Ports:** the API listens on `PORT` (4100 here, 4000 in the image); the healthcheck targets
  `/health/live` on the same port. Not executed in a container.

## 11. Tests

| Suite | Result |
|---|---|
| API full suite (`npx jest`, 2 workers), with JSON output | 133 suites, **1677 tests: 1664 passed, 13 failed** |
| ↳ the 2 suites that failed | `businessPromotion.controller` (13 tests, 5 s hook timeouts) → **13/13 on isolated rerun**. `menuImport/extractionPipeline.service` (4 tests, Redis "Connection is closed" on the local 3.0.504 instance) → **4/4 on isolated rerun**. |
| API full suite, earlier run this phase | 1675 / 1677 passed. The failures (`stripeConnectWebhook` 9, `planCatalogSeed` 7, `subscriptionBackfill` 4, the last failing to start) all passed on isolated rerun. |
| **API result** | **1677 / 1677 pass** (in a full run or on isolated rerun). No test failed for a code reason. |
| Admin unit | 2 suites, **9 / 9** |
| Storefront unit | 3 suites, **22 / 22** |
| `packages/utils` | 1 suite, **8 / 8** |
| Lint (all four apps) | exit 0; **0 errors**, 42 warnings (API 11, web 12, admin 19, marketing 0), all pre-existing |
| Production builds | web, admin and marketing with production values: exit 0; API `tsc` exit 0 |
| Targeted Playwright (dev servers) | 10 specs, **15 / 15 passed**. The full 70-spec suite was **not** run. |
| Production browser smoke (scratch, real hostnames, production builds and API) | 9 / 9 checks passed (marketing, `/demo` link, demo checkout, customer order, Owner Portal, POS, agency., admin., custom-domain host), plus the active-custom-domain check. Two caveats: the custom-domain check passed only after the storefront was rebuilt cleanly (§13, issue 1), and my first `/demo` check wrongly expected an iframe — the page uses a link by design — so it was rewritten to follow the link. |
| Docker image builds / container start | **not run (no Docker)** |

**Correction to Phase 85A.** Its report said "1694 / 1694". Three full runs this phase, each with a
different suite failing to start, all reported **1677** total tests. Jest had already counted the
non-starting suites' tests, so Phase 85A's figure double-counted 17. The 85A report now says
1677 / 1677, with a note.

## 12. Remaining External Inputs

- **Docker** on a machine that can build and run the four images. This is the first gap to close.
- **Managed Redis ≥ 6.2** for production. Compatibility is shown here with 8.10.1;
  `maxmemory-policy noeviction` and persistence aren't verified.
- **MongoDB Atlas** production connection: tier, backups, network access.
- **S3-compatible object storage**. Uploads were not exercised; production throws without it.
- **Transactional SMTP** plus SPF, DKIM and DMARC. Every send here went to a dead local port.
- **Edge/TLS** for the seven hostnames, real certificates, WebSocket upgrade, and `TRUST_PROXY`
  set to the edge's actual address range.
- **Production DNS.**
- **Custom domains:** an edge with on-demand TLS, plus the issuance check (85A contract §2.3),
  plus `CUSTOM_DOMAIN_CNAME_TARGET`.
- **Paddle production:** account, products/prices, price-ID mapping, webhook, domain approval,
  and one live transaction.
- **Stripe or Safepay live accounts**, if online payments are offered.
- **Marketplace approvals** (Uber Eats, DoorDash, foodpanda) and production OAuth callbacks.
- **Legal entity and legal-page details**, support inboxes, refund policy.
- A **scheduler** for `cleanupDemoData.js`, and **uptime monitoring and log alerting**.

## 13. Issues Found

**1. Native production frontend builds pick up local `apps/*/.env` files**

| | |
|---|---|
| Severity | Medium (configuration hazard; production impact if anyone builds from a dev checkout) |
| Root cause | Vite merges `apps/<app>/.env` into a production build. This machine's `apps/web/.env` sets `VITE_RESTAURANT_SLUG=demo-restaurant`, so the first native storefront build redirected **every unmapped hostname to the demo restaurant**: a stranger's domain pointed at the edge would show Wildwood Kitchen. The Docker build is protected (`.dockerignore` excludes `**/.env`); `check-build-env.sh` only sees the process environment. |
| Fix | Documentation only, no code change: `docs/production-architecture.md` §4 now says to build from a clean checkout or the Docker image, and to leave `VITE_RESTAURANT_SLUG` unset in production. |
| Verification | Rebuilt with `VITE_RESTAURANT_SLUG` empty; the unmapped host now shows the honest "This link doesn't specify a restaurant" message (smoke step re-asserted). |

**2. Phase 85A report overstated the API test total**

| | |
|---|---|
| Severity | Low (reporting accuracy) |
| Root cause | 1677 + 17 tests from suites that failed to start, which Jest had already counted |
| Fix | 85A report corrected to 1677 / 1677, with a note |
| Verification | Three full runs, all reporting 1677 total |

**3. API image will contain lint tooling (`typescript`, `eslint`) and frontend runtime dependencies**

| | |
|---|---|
| Severity | Low (size only, inert; never loaded by the API) |
| Root cause | `npm prune --omit=dev` keeps every workspace's `dependencies`, and `packages/config` declares its lint tooling as `dependencies` |
| Fix | **Not fixed.** Changing the Dockerfile's install strategy can't be verified without Docker. Revisit when images can be built. |
| Verification | `npm ls typescript eslint --omit=dev` in the staged runtime |

**4. Expected 503 ("paid checkout not available yet") is logged at `error` level**

| | |
|---|---|
| Severity | Low (alert noise once log alerting exists) |
| Root cause | The error handler logs every 5xx as an error |
| Fix | Not fixed; it's a logging-policy decision, out of scope |
| Verification | Production log |

**5. Marketing `sitemap.xml` comment text rewritten**

| | |
|---|---|
| Severity | Cosmetic |
| Root cause | The build plugin replaces the placeholder origin everywhere in the file, including an XML comment |
| Fix | Not fixed |
| Verification | — |

**6. Marketing bundle includes the Socket.IO client library**

| | |
|---|---|
| Severity | Cosmetic (bundle size) |
| Root cause | Shared-package import, presumably `@restaurant/utils`; not investigated further |
| Fix | Not fixed |
| Verification | — |

**Repository changes this phase:** one paragraph in `docs/production-architecture.md` (issue 1),
the test-count correction in `PHASE_85A_…_REPORT.md` (issue 2), and this report. No code changed.
All scratch tooling (image-equivalent runtime, edge, smoke scripts, test certificate, env file,
disposable credentials) lives in the session scratchpad, outside the repo. Secrets and credentials
there were deleted. The disposable databases were dropped and Redis db 14 flushed.

## 14. Recommended Next Phase

Install Docker (Docker Desktop with WSL 2 on this machine, or any Linux host/CI runner), then
re-run Phase 85B's container steps:

1. `docker build` of `api.prod.Dockerfile` and of `frontend.prod.Dockerfile` for each `APP`;
   record sizes.
2. Run them on one network with a `redis:7` container and a disposable Mongo, `API_UPSTREAM=http://api:4000`.
3. Confirm:
   - the healthcheck reports healthy;
   - `nginx -t` passes and the templates render;
   - SPA fallback and `/api` proxying work in nginx;
   - `docker stop` produces the graceful-shutdown log within 15 s;
   - the image runs as `node`;
   - `docker history` and an image filesystem scan show no `.env` files.
4. Decide on issue 3 once there's a measured image size.

Only after that should real infrastructure provisioning (managed Redis, storage, SMTP, edge, DNS)
begin.
