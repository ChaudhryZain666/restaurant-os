# Phase 85A — Production Engineering Hardening, Portal Architecture & Deployment Readiness

Baseline: `6ee44cf` (Phase 84 RC was `a7f60ab`; the commits in between touched only marketing and
shared packages). Nothing in this phase is committed yet.

## Executive status

**COMPLETE — EXTERNAL INFRASTRUCTURE REMAINS**

All six engineering blockers from the readiness audit are fixed in code and covered by tests
(Paddle environment, trust proxy, mock payments, custom-domain honesty, production packaging,
production-safe demo), along with the three non-blocking audit items (absolute sitemap URL,
payment-method update path, stale docs). No production service was connected, configured or
modified.

Two caveats, stated plainly:

- **The Docker images have never been built**: Docker isn't installed on this machine. The
  commands they wrap were verified natively (see Tests). UNVERIFIED — REQUIRES EXTERNAL CONFIRMATION.
- **Custom domains still can't serve customers.** That needs edge infrastructure plus one small
  engineering item (a certificate-issuance check) that depends on which edge is chosen. The product
  now says so honestly instead of claiming the feature is live (see Custom domains).

## Changes made

### Paddle environment selection (audit blocker 1)
- `apps/admin/src/lib/paddle.ts`: removed the hardcoded `Paddle.Environment.set("sandbox")`. Paddle.js
  is now initialised for the environment the checkout session names; it refuses to re-initialise
  for a different one.
- `apps/admin/src/lib/paddleEnvironment.ts` (new): validates the session's `environment`, with no
  fallback. Missing or unknown values, and a token from the other environment (`test_` with
  production, `live_` with sandbox), throw a clear `PaddleConfigurationError`.
- `apps/api/src/billing/PaddleBillingProvider.ts`, `BillingProvider.ts`: checkout sessions carry
  `environment`, derived from the Paddle host the adapter actually calls (`PADDLE_ENV`), so it can't
  drift from where the prices and customers live.
- `apps/api/src/config/env.ts`: in production with `BILLING_PROVIDER=paddle`, boot fails unless
  `PADDLE_ENV=production`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` and a non-`test_`
  `PADDLE_CLIENT_TOKEN` are all set. Development and test can still use the sandbox.
- `BillingPage.tsx` and `AgencyBillingPage.tsx` pass the session object through.

### Express trust proxy (audit blocker 2)
- `apps/api/src/config/trustProxy.ts` (new): parses `TRUST_PROXY` as nothing, a hop count (1–10),
  or IPs/CIDRs/named ranges. `true`, `*` and `all` are refused because the client controls the
  leftmost `X-Forwarded-For` entry. Malformed values are refused.
- `apps/api/src/app.ts`: `app.set("trust proxy", …)` before any limiter.
- `env.ts`: `TRUST_PROXY` is validated in every environment and **required** in production
  (`none` is an allowed explicit answer).
- Trust model documented in `docs/production-architecture.md` §2. Prefer the edge's CIDR, which
  stays safe even if the API port is reachable directly.

### Mock payments fail closed in production (audit blocker 3)
- `apps/api/src/config/mockDrivers.ts` (new): `mockDriversAllowed(nodeEnv)` returns false in production.
- `payments/restaurantProvider.ts`: `canProcessOnlinePayments(hasOwnAccount, pooledProvider, nodeEnv)`.
  The mock exemption applies to development and test only. Both call sites pass `NODE_ENV`:
  starting a payment (`payment.service.ts`) and enabling online payments (`restaurant.controller.ts`).
- Mock completion route (`payment.routes.ts`): not registered in production, and its controller
  re-checks per request (404).
- Mock payment webhook (`paymentWebhook.controller.ts`): 404 in production.
- **Same class of hole, closed for the other mock providers:**
  - Billing: the mock checkout and advance routes are not registered and their controllers refuse;
    the mock billing webhook returns 404; paid checkout through mock billing returns 503 "not
    available yet, your trial stays active".
  - Marketplace: mock-mode webhooks return 404.
  - POS terminal: the mock completion route is not registered and refused; `POS_TERMINAL_PROVIDER=mock`
    fails boot in production.
- **Found during this phase:** `notification.queue.ts` emailed order confirmations for public
  demo-playground orders to throwaway `@playground.demo.local` addresses. In production that sends
  real mail into bounces and harms the sending domain's reputation. Demo orders (`Order.isDemo`) no
  longer send email; realtime events are unchanged.

### Custom domains made honest (audit blocker 4)
- The API's domain list returns `routing: { servingAvailable, cnameTarget }`, driven by the new
  optional `CUSTOM_DOMAIN_CNAME_TARGET`.
- `DomainSettingsPanel.tsx`: while serving isn't available, an info banner says domains can be
  verified and saved but don't serve customers yet. An activated domain is labelled
  "Activated — not serving traffic yet", never "Active". Once a target is configured, the panel
  shows the exact CNAME record (subdomains only).
- Socket.IO accepts active custom-domain origins over https (`realtime/realtimeOrigins.ts`; DB-backed,
  cached 60s, fails closed).
- Self-claim protection: previously only the storefront hostname was blocked exactly. Now every
  platform hostname and anything under them (all of `*.garnishtable.com`) can't be claimed, even as
  pending (`isSelfClaim` + `platformHostnames`; agency white-label domains too).
- `docs/custom-domains-infrastructure-contract.md` (new): verification, DNS target, routing, TLS,
  host→restaurant resolution, API/cookies, Socket.IO, security, and failure behaviour.
- `e2e/custom-domain-management.spec.ts`: asserts the new honest label and banner.
- No plan, entitlement or feature was removed.

### Production packaging (audit blocker 5)
- `infrastructure/docker/api.prod.Dockerfile` (new): multi-stage build. The runtime image runs
  `node dist/index.js` as `node`, with no dev dependencies, a `/health/live` healthcheck, and
  SIGTERM-driven graceful shutdown.
- `infrastructure/docker/frontend.prod.Dockerfile` (new, `APP=web|admin|marketing`): Vite production
  build, then nginx with SPA fallback, `/api` proxy, and a 100 MB body limit.
  `check-build-env.sh` (new) fails the build when a required `VITE_*` value is missing or localhost.
- `infrastructure/docker/nginx/*.template` (new): the shared server block plus per-app locations.
  The storefront proxies `/sitemap.xml`; admin 404s it; marketing serves its static file.
- `.dockerignore` (new): excludes every `.env`, `node_modules`, `dist`, and local state.
- The development Dockerfiles are kept for `docker-compose.yml`, relabelled "DEVELOPMENT — never production".

### Production-safe demo (audit blocker 6)
- `apps/api/src/services/productionDemo.service.ts` and `scripts/provisionProductionDemo.ts` (new):
  creates only the Wildwood Kitchen storefront at slug `demo-restaurant`.
- `scripts/demo/wildwoodKitchenCatalog.ts` (new): 7 categories, 28 items, 11 modifier groups,
  profile and theme, exported from the dev seed's final state. Images are the storefront's own
  static files, so no object storage is needed.
- npm script `demo:provision` for development; production runs `node dist/scripts/provisionProductionDemo.js`.

### Portal architecture (hostname contract)
- `env.ts`: `PORTAL_ORIGINS` (agency., admin., pos.) is validated, rejected if localhost in
  production, and added to CORS and Socket.IO (`config/origins.ts`, new).
- `apps/admin`: on the POS hostname, `/` opens `/pos` for users holding `restaurant.pos.operate`
  (`lib/portalHosts.ts`, new; `App.tsx` `IndexRoute`). Agency and platform users already land in
  their sections by role. It's keyed on the real permission, so there's no redirect loop.
- New admin build variables: `VITE_POS_URL`, `VITE_AGENCY_URL`, `VITE_PLATFORM_ADMIN_URL`.

### Robots / sitemap
- `apps/web/vite.config.ts`: the production build rewrites `robots.txt` to an absolute sitemap URL
  from `VITE_SITE_URL`, using the same convention as marketing. It warns if unset. Development keeps
  the relative line.

### Payment method management
- `BillingProvider.getPaymentMethodUpdateUrl`. Paddle reads `management_urls.update_payment_method`
  from `GET /subscriptions/{id}`, a documented field of Paddle Billing's subscription entity, fetched
  per click and never stored. The mock provider returns null.
- `POST /businesses/:id/subscription/payment-method-update` and
  `POST /agencies/:id/subscription/payment-method-update`, both requiring billing manage permission.
- The billing pages show **Update payment method** for Paddle subscriptions (primary button when
  past due).
- UNVERIFIED — REQUIRES EXTERNAL CONFIRMATION against a live Paddle subscription.

### Configuration, docs and tests infrastructure
- Env examples:
  - `apps/api/.env.production.example` (new): the full production contract, all secrets empty.
  - Updated `apps/api/.env.example`, `apps/admin/.env.example`, `apps/web/.env.example`.
  - `apps/marketing/.env.example` (new).
- `docs/production-architecture.md` (new): hostname contract, routing, trust model, single API
  instance, build/start/deploy commands, fail-closed rules, known constraints.
- `docs/production-launch-checklist.md`: updated for this phase, with the stale Redis, storage and
  mode statements corrected.
- `PHASE_83_…_REPORT.md`: a 5-line errata block only; the report is otherwise untouched.
- `apps/admin`: a Jest setup mirroring `apps/web` (`jest.config.js`, `tsconfig.jest.json`, `test`
  script, `jest`/`ts-jest` devDependencies; `package-lock.json` +2 lines). Test files are excluded
  from the app's `tsc` build.

## Tests

All runs are on this machine (Windows 11, Node 22, local MongoDB replica set, local Redis 3.0.504).

| Suite | Result |
|---|---|
| API, full suite, serial (`npx jest --runInBand`) | 133 suites, **1677 / 1677 tests passing** (corrected in Phase 85B: this cell originally said 1694 by also adding the 17 tests of the two suites that failed to start, which Jest had already counted in its 1677 total). The serial run passed 130 suites (1663 of 1677 tests). The other 3 failed on this machine's environment and **all passed on isolated rerun**: `businessAnalytics.controller` (14 tests, 5s hook timeouts → 14/14), and `indexMaintenance.service` (7/7) and `orderPricing.service` (10/10), which failed to start with Redis "Connection is closed". |
| API, new and changed suites | see the list below |
| Admin unit (`apps/admin`, new) | 2 suites, **9 passed / 9** |
| Storefront unit (`apps/web`) | 3 suites, **22 passed / 22** |
| `packages/utils` | 1 suite, **8 passed / 8** |
| TypeScript: API source, every API test file, admin `tsc -b` | 0 errors |
| Root `npm run build` (packages, API, web, admin, marketing) | exit 0 |
| Production-value storefront build | exit 0; `dist/robots.txt` → `Sitemap: https://order.garnishtable.com/sitemap.xml`; no localhost URL in the bundle |
| `npm run lint` (all four apps) | exit 0. **0 errors**; 42 warnings (API 11, web 12, admin 19, marketing 0), all pre-existing — none on lines changed in this phase. |
| Playwright (targeted) | 10 specs, **15 / 15 passed** (Chromium, 2 workers, against the local dev servers): `custom-domain-management` (updated for the honest label), `online-payment`, `billing-subscription-lifecycle`, `kitchen-realtime` (the new Socket.IO origin check), `demo-restaurant-menu-ordering`, `pos-terminal-payment`, `pos-direct-access-and-payment-confirmation`, `auth-session`, `platform-admin-routing`, `admin-rbac-nav`. The full Playwright suite (70 specs) was **not** run. |

**New and changed API tests**, all passing:

- `config/trustProxy.test.ts`: parsing; direct requests; requests through the trusted proxy;
  spoofed `X-Forwarded-For`; a caller bypassing the proxy; per-client rate-limit buckets; rotating a
  spoofed header doesn't escape a bucket; the pre-85A shared-bucket behaviour; `createApp` applies
  the setting.
- `config/mockDrivers.production.test.ts`: covers the HTTP surface. In test mode, a mock payment
  completes end to end. In production:
  - starting an online payment through mock is refused;
  - an owner can't enable online payments;
  - mock-complete returns 404 and the payment stays pending / the order unpaid;
  - a correctly signed mock payment webhook returns 404, while the same payload returns 200 in test;
  - mock billing webhook, mock checkout completion, mock checkout creation (503), and the
    advance/checkout/terminal controllers are all refused;
  - a signed mock marketplace webhook returns 404.
- `config/env.test.ts`: covers the production contract, required `TRUST_PROXY`, rejection of
  `true`, `PORTAL_ORIGINS` validation, mock terminal rejection, and Paddle production rules (no
  sandbox, no silent default, missing credentials, `test_` token).
- `payments/restaurantProvider.test.ts`: real providers are unchanged; mock is refused in production.
- `billing/PaddleBillingProvider.test.ts`: checkout `environment` for each host;
  `getPaymentMethodUpdateUrl`.
- `realtime/realtimeOrigins.test.ts`: CORS and Socket.IO allow-lists, and the custom-domain origin check.
- `services/productionDemo.service.test.ts`: creates when absent, is idempotent, never overwrites,
  refuses a foreign-owned slug.
- `controllers/domainRouting.test.ts`, and `services/domainVerification.service.test.ts` for platform
  self-claims.
- `controllers/subscription.controller.test.ts`: payment-method-update returns 404, 400, 503,
  503 for a provider mismatch, and 403 for staff.

**Run directly against the compiled build:**

- `node dist/index.js` (development mode, `PORT=4100`) boots; `/health/live` 200, `/health` 200
  (Mongo up, Redis up), `/api/docs/` 200, `/api/v1/public/plans` 200.
- A production boot with a bad config exits 1 and names `TRUST_PROXY`, `POS_TERMINAL_PROVIDER`,
  `PADDLE_ENV`, `PADDLE_WEBHOOK_SECRET` and `PADDLE_CLIENT_TOKEN`.
- `node dist/scripts/provisionProductionDemo.js` against a throwaway database:
  - First run created 1 user, 1 business, 7 categories, 28 items, 11 modifier groups, 0 orders.
  - Second run created nothing.
  - The database was dropped afterwards.
- Against the dev database, where `demo-restaurant` is owned by the dev seed, it refused with exit 1
  and changed nothing.
- `check-build-env.sh` fails on missing values (exit 1), passes with production values (exit 0), and
  fails on a localhost value (exit 1).

**Test-environment note (pre-existing, not caused by this phase).** In parallel Jest runs on this
machine, some suites intermittently hit Jest's 5s hook timeout or ioredis "Connection is closed"
(local Redis 3.0.504; `jest.config.js` documents the contention). Every suite that failed that way
passed on rerun in isolation, and the serial run above is the authoritative result. Parallel full
runs during this phase:

- **Run 1:** 1666/1666 tests passed. 3 suites failed to start: two hit Redis "Connection is closed",
  and `app.test.ts` compiled a file I was mid-way through editing. All three passed on rerun.
- **Run 2:** 1662/1672 passed, with the admin build running at the same time. The 10 failures were
  in 4 suites: Jest's 5s timeout, plus one realtime-event assertion in
  `deliveryDispatch.service.test.ts`. All passed on rerun; `deliveryDispatch` passed 19/19 twice in
  isolation.

## Production packaging

| Component | Build | Start / serve |
|---|---|---|
| API (HTTP + Socket.IO + BullMQ worker + repeatable jobs) | `npm ci && npm run build:packages && npm run build -w apps/api` | `cd apps/api && node dist/index.js` (`NODE_ENV=production`); image `api.prod.Dockerfile` |
| API deploy steps | — | `node dist/scripts/ensureIndexes.js` every deploy; `seed.js`; `bootstrapPlatformAdmin.js` once; `provisionProductionDemo.js`; schedule `cleanupDemoData.js` |
| Marketing | `npm run build:packages && npm run build -w apps/marketing` (with `VITE_SITE_URL`, `VITE_STOREFRONT_URL`, `VITE_ADMIN_URL`) | static `apps/marketing/dist` + SPA fallback; image `frontend.prod.Dockerfile APP=marketing` |
| Owner Portal + Agency Portal + Platform Admin + POS (one build) | `npm run build -w apps/admin` (with `VITE_API_URL`, `VITE_STOREFRONT_URL`, `VITE_MARKETING_URL`, `VITE_POS_URL`, `VITE_AGENCY_URL`, `VITE_PLATFORM_ADMIN_URL`) | the same `apps/admin/dist` served on app., agency., admin. and pos.; image `APP=admin` |
| Customer Storefront | `npm run build -w apps/web` (with `VITE_API_URL`, `VITE_SITE_URL`, `VITE_ADMIN_URL`, `VITE_MARKETING_URL`) | static `apps/web/dist` + SPA fallback + `/sitemap.xml` proxy, on order. and customer domains; image `APP=web` |

Image builds are UNVERIFIED — REQUIRES EXTERNAL CONFIRMATION (no Docker here); so is nginx config
validation (`nginx -t`) and in-container graceful shutdown. The development Dockerfiles and
`docker-compose.yml` are unchanged in behaviour.

## Hostname architecture

```text
Marketing:            https://garnishtable.com
Owner Portal:         https://app.garnishtable.com
Agency Portal:        https://agency.garnishtable.com
Platform Admin:       https://admin.garnishtable.com
POS:                  https://pos.garnishtable.com
Customer Storefront:  https://order.garnishtable.com
API / Socket.IO:      https://api.garnishtable.com
```

- Owner Portal, Agency Portal, Platform Admin and POS are role-based experiences inside one admin
  application. POS is its own operational shell, served on its own hostname.
- Every frontend hostname must proxy `/api` to the API; the API hostname needs WebSocket upgrade.
- Customer custom domains are separate from these and are tenant data.
- The API remains a single production instance.

Details: `docs/production-architecture.md`.

## Paddle

> Paddle production is NOT configured in Phase 85A.

Code readiness: the environment comes from the API, production can't run on the sandbox, and
credentials and the client token are checked at boot. Sandbox is unchanged for development.

**Remains for Phase 85B/85C:**

1. Create the Paddle production account (needs the legal entity), products, and monthly/yearly
   prices for `owner_starter`, `owner_growth` and `agency_growth_v2`.
2. Write the production price and product IDs into the production `Plan` documents. There's no
   tooling or UI for this; it's a manual database update.
3. Set `BILLING_PROVIDER=paddle`, `PADDLE_ENV=production`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`,
   and the `live_` `PADDLE_CLIENT_TOKEN`.
4. Register the webhook at `https://api.garnishtable.com/api/v1/webhooks/billing/paddle`. Get the
   checkout domains `app.garnishtable.com` and `agency.garnishtable.com` approved.
5. Prove one live transaction end to end (checkout → webhook → entitlement), and the
   "Update payment method" link on a live subscription. Both are UNVERIFIED — REQUIRES EXTERNAL
   CONFIRMATION.

## Infrastructure

**Code ready (this phase or earlier, with test evidence):**

- boot-time production validation;
- trust proxy;
- CORS and Socket.IO for all portals;
- mock providers fail closed;
- Paddle environment handling;
- health endpoints;
- graceful shutdown (unit-tested in `shutdown.test.ts`);
- the compiled API start;
- static frontend builds;
- the demo provisioner;
- the absolute storefront sitemap.

**Infrastructure required (to provision in 85B):**

- **Compute:** one API process, with a supervisor, restart, and stop timeout of at least 15s.
- **Edge:** TLS for seven hostnames, `/api` proxy on every frontend host, WebSocket upgrade on
  `api.`, 100 MB bodies, SPA fallback.
- **Redis:** managed, version 6.2 or later, `noeviction`, persistence.
- **Object storage:** S3-compatible, with public read for images.
- **Transactional email:** an SMTP relay, plus SPF, DKIM and DMARC.
- **DNS:** records for the seven hostnames.
- **Monitoring:** uptime checks on `/health` and log alerting.
- **Scheduler:** a job for `cleanupDemoData.js`.
- **Geocoding:** a LocationIQ key, if delivery is offered.
- **Database:** confirm the Atlas tier and backups (M0/M2/M5 have no automated backups) —
  UNVERIFIED — REQUIRES EXTERNAL CONFIRMATION.
- **Later, for custom domains:** an edge with on-demand TLS, plus `CUSTOM_DOMAIN_CNAME_TARGET`.

**External approval required:**

- Paddle production and domain approval;
- Uber Eats (written API approval);
- DoorDash (TAM certification, plus a connect flow still to build);
- foodpanda (partner access);
- Stripe or Safepay live accounts, only if online payments launch.

**Founder input required:**

- legal entity name, jurisdiction and address for the Terms, Privacy and Refund pages and Paddle;
- support inbox(es) and `CONTACT_NOTIFICATION_EMAIL`;
- refund policy specifics;
- whether launch is cash-only or uses online payments;
- whether custom domains are sold at launch, given they won't serve traffic until the edge
  capability exists.

## Custom domains

**Implemented:**

- add, with validation and blocking of every platform hostname;
- DNS TXT ownership verification at `_garnishtable-verify.<host>` (`DNS_VERIFIER=node`);
- activation, one active domain per location;
- host → restaurant resolution, gated on active status and the `custom_domains` entitlement;
- canonical URL and sitemap entries, and branding suppression;
- the Socket.IO origin check;
- plan-lapse behaviour;
- honest admin UI, and the CNAME instruction once a target exists.

**Requires edge and TLS infrastructure:**

- a CNAME target host;
- routing customer hostnames to the storefront with `/api` and `/sitemap.xml` proxied;
- on-demand certificate issuance and renewal, gated on active mappings;
- HTTP → HTTPS redirect.

**Remaining engineering, once an edge is chosen:** the issuance check the edge calls before
issuing a certificate (contract §2.3). Not built, because its shape depends on the edge.

Until then, verified and activated domains serve no traffic, and the UI says exactly that.

## Payments

**Mock online payments are impossible in production after this phase.** With
`NODE_ENV=production` and `PAYMENT_PROVIDER=mock`:

- payment creation through mock is refused ("please pay with cash");
- enabling online payments without a connected account is refused;
- the mock completion route isn't registered, and its controller returns 404 regardless;
- the mock payment webhook returns 404 even with a valid signature.

Each is proven in `mockDrivers.production.test.ts`. The same holds for mock billing, marketplace
and terminal drivers.

**Unaffected:**

- cash payments (the existing cash-order and POS suites pass);
- a restaurant's own connected Stripe/Safepay account (BYOC);
- real pooled providers (`canProcessOnlinePayments(true, …)`), and the BYOC and Stripe Connect
  webhook paths;
- development and test mock flows.

Stripe and Safepay remain unexercised against live accounts — UNVERIFIED — REQUIRES EXTERNAL
CONFIRMATION.

## Demo

`demo-restaurant` is provisioned in production by running
`node dist/scripts/provisionProductionDemo.js` from `apps/api` on the first deploy. It's safe to
repeat on every deploy.

- It creates the owner placeholder `demo-owner@demo-restaurant.garnishtable.invalid` (a reserved,
  undeliverable TLD) with a random, never-printed password, so nobody can sign in as it.
- It also creates the business, the restaurant (active, cash and pickup/delivery/dine-in, online
  payments off, 24/7 hours, cinematic theme), and the menu.
- It never creates orders, customers, staff, tickets or platform accounts. It never overwrites
  existing demo content, and never duplicates it.
- If the slug belongs to anyone else, it refuses with exit 1 and changes nothing.
- The marketing URL `/r/demo-restaurant` is unchanged.
- Demo-guest accounts expire. Schedule `cleanupDemoData.js` so they're removed.

## Remaining blockers

1. **Infrastructure isn't provisioned:** compute, edge/TLS, Redis 6.2 or later, object storage,
   SMTP, and DNS (Phase 85B).
2. **Paddle production doesn't exist yet**, and its price IDs need mapping (see Paddle). Until
   then, production offers trials only.
3. **Legal placeholders** on the Terms, Privacy and Refund pages (founder input).
4. **Docker images and nginx config have never been built or run** — UNVERIFIED — REQUIRES
   EXTERNAL CONFIRMATION. Build and run both images once in 85B before relying on them.
5. **Custom domains can't serve traffic** until the edge exists and the issuance check is built.
   Not a launch blocker if they're not promised as live at launch; that's a founder decision.
6. **The BullMQ worker against a real Redis 6.2+ wasn't exercised here** (local Redis is 3.0.504) —
   UNVERIFIED — REQUIRES EXTERNAL CONFIRMATION in 85B. The production boot check refuses Redis
   below 5.0.
7. **Known constraint, not a blocker:** keep `ANTHROPIC_MODEL=claude-sonnet-4-5`. The extractor
   forces `tool_choice: {type: "tool"}`, which Opus 5.5 and Sonnet 5.5 reject, so moving models
   needs a code change. Not done in this phase, by design.
8. **Unchanged from the audit:**
   - marketplace approvals (not launch-blocking);
   - the DoorDash connect flow;
   - the Atlas backup tier;
   - the marketing pricing page still lists "Custom domain / white-label" as a Growth/Agency
     entitlement. That's true of the entitlement, but it can't be used until the edge exists.

## Recommended next phase

**Phase 85B — Production Infrastructure Provisioning.** This engineering phase is complete;
Phase 85B is not started. Its first step should be building and running both production images
against the real managed Redis, storage and SMTP, then confirming that the compiled worker,
WebSocket upgrade through the edge, and `TRUST_PROXY` behave as documented.
