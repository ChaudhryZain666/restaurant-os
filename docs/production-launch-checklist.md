# Production Launch Checklist

Phase 83 — the single operational checklist to run through immediately before and during cutover
to production. Each item states its current status and who owns closing it. Items marked
**EXTERNAL INPUT REQUIRED** cannot be resolved by engineering alone.

**Updated in Phase 85A** to match the code: the hostname contract, `TRUST_PROXY`, production
packaging, fail-closed mock providers, Paddle environment checks, and corrections to three stale
statements (Redis check, object storage, menu-extraction mode). The architecture and the exact
build/start/deploy commands are in `docs/production-architecture.md`.

Legend: ✅ Done · 🔴 Blocking (must close before launch) · 🟡 Non-blocking (safe to launch without,
should close soon after) · 🔵 External dependency.

---

## 1. Infrastructure

- 🔴 Set `NODE_ENV=production` on every deployed API instance. The env schema's `superRefine` block
  (`apps/api/src/config/env.ts`) will refuse to boot if any of the checks below are unmet — this is
  intentional and is the actual enforcement mechanism for most of this section, not just documentation.
- 🔴 Set the hostname contract (`docs/production-architecture.md`):
  `CLIENT_ORIGIN=https://order.garnishtable.com`, `ADMIN_ORIGIN=https://app.garnishtable.com`,
  `MARKETING_ORIGIN=https://garnishtable.com`, `API_PUBLIC_ORIGIN=https://api.garnishtable.com`, and
  `PORTAL_ORIGINS` = the agency., admin. and pos. origins. Boot fails if any is left on localhost.
  Template: `apps/api/.env.production.example`.
- 🔴 Set `TRUST_PROXY` to the proxies in front of the API (Phase 85A). Production refuses to boot
  without it; `true` is refused everywhere. Without it every rate limiter keys on the edge's IP.
- 🔴 Configure the edge: TLS for all seven hostnames, `/api/*` forwarded to the API from every
  frontend hostname, `/sitemap.xml` forwarded on storefront hostnames, WebSocket upgrade on `api.`,
  request bodies up to 100 MB on `/api`, SPA fallback. Packaging for this is
  `infrastructure/docker/frontend.prod.Dockerfile`.
- 🔴 Set `MONGO_URI` to the production replica-set connection string (transactions require a replica
  set — confirmed in earlier phases' audits — a standalone Mongo instance will fail at runtime on
  the first multi-document transaction, not at boot).
- 🔴 Set `REDIS_URL` to a managed Redis **≥ 6.2** (`rediss://` for TLS). Corrected in Phase 85A:
  `checkRedisVersion.ts` **refuses to boot** in production below 5.0.0 (BullMQ's hard minimum) and
  warns below 6.2. Configure `maxmemory-policy noeviction` (BullMQ) and persistence — refresh-token
  sessions and queued jobs live only in Redis.
- 🔴 Configure object storage (`STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`,
  `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_URL`). Corrected in Phase 85A: storage is **required** in
  production — `storage/index.ts` throws on the first upload without it; the local-disk adapter is
  development-only. Images need public read; menu-import source files under
  `restaurants/*/menu-imports/` are only ever read server-side.
- 🔴 Deploy with `infrastructure/production/scripts/deploy.sh sha-<commit>` (Phase 87): it runs
  `ensureIndexes` on every deploy and, with `--init`, the plan seed and demo storefront. Still run
  `node dist/scripts/bootstrapPlatformAdmin.js` once by hand (docs/production-deployment-runbook.md).
- 🔴 Run exactly **one** API instance (HTTP + Socket.IO + in-process worker; no Socket.IO Redis
  adapter) under a supervisor with automatic restart, liveness `GET /health/live`, readiness
  `GET /health`, and a stop timeout of at least 15s. Image: `infrastructure/docker/api.prod.Dockerfile`.

## 2. Security

- 🔴 Set `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` to real, random, ≥32-character production
  values, distinct from any value used in development — the schema enforces the length but cannot
  enforce randomness or non-reuse.
- 🔴 Confirm TLS termination (HTTPS) is in front of every one of the four origins above — the app
  itself does not terminate TLS.
- 🟡 Rotate any credential that was ever pasted into a chat log, ticket, or shared document during
  development.
- ✅ Rate limiting is env-configurable (`AUTH_RATE_LIMIT_MAX`, `GLOBAL_RATE_LIMIT_MAX`,
  `CONTACT_RATE_LIMIT_MAX`) with sane production defaults already in place; no action required
  unless the founder wants different limits.

## 3. Payments

- ✅ A cash-only launch (`PAYMENT_PROVIDER=mock`) is safe as of Phase 85A: in production the mock
  provider can't process an online payment, owners can't switch online payments on without a real
  connected account, and the mock completion route and mock payment webhook return 404
  (`config/mockDrivers.ts`, covered by `config/mockDrivers.production.test.ts`).
- 🔴 For real online payments, set `PAYMENT_PROVIDER` to `stripe` or `safepay`. Neither adapter has
  been exercised against a live account.
- 🔴 Set the real provider's API keys/webhook secrets for whichever of `stripe`/`safepay` is chosen.
- 🔵 **EXTERNAL INPUT REQUIRED**: confirm the payment provider account itself is out of test/sandbox
  mode and approved for real transactions — this is an account-level setting on the provider's own
  dashboard, not something this codebase can verify.
- 🟡 Confirm `API_PUBLIC_ORIGIN` (see §1) is correct before any restaurant owner connects a real
  payment account via BYOC — the webhook URL shown to them in `restaurantPaymentAccount.controller.ts`
  is built directly from this value.

## 4. Billing (platform SaaS subscriptions)

- 🔴 Set `BILLING_PROVIDER=paddle` once Paddle production exists. Phase 85A: production then refuses
  to boot unless `PADDLE_ENV=production`, `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` and a live
  (`live_…`, not `test_…`) `PADDLE_CLIENT_TOKEN` are set, and the admin app initialises Paddle.js
  for the environment the API reports (it was hardcoded to sandbox before Phase 85A). Until then,
  `BILLING_PROVIDER=mock` in production means trials only: paid checkout answers "not available yet",
  and every mock billing route and webhook is refused.
- 🔴 Create the Paddle production products/prices and write their IDs into the production `Plan`
  documents (`pricing[].providerPriceId` / `providerProductId`) — the seed writes `mock_price_*`
  placeholders and no tooling sets real IDs. Register the webhook at
  `https://api.garnishtable.com/api/v1/webhooks/billing/paddle`, and get the checkout domains
  (`app.` and `agency.`) approved in Paddle.
- 🔵 **EXTERNAL INPUT REQUIRED**: confirm the Paddle account is live (not sandbox) — per existing
  project history, Owner + Agency Growth checkout/entitlements were verified live in *sandbox* only;
  production webhook delivery has not yet been proven end-to-end against a real Paddle production
  account. This is the single largest unresolved billing risk carried into Phase 83.
- ✅ **Commercial pricing — LOCKED (Phase 85 pre-launch decision)**: `owner_starter` ($59/mo),
  `owner_growth` ($99/mo), `agency_growth_v2` ($179/mo) is the final launch catalog, confirmed
  against real competitive pricing research (Restolabs' $69/$99/$199 tiers are the closest direct
  comparable — same 0%-commission, tiered-SaaS, agency-reseller positioning — and independently
  validate this range; ChowNow/Owner.com/Popmenu/Lunchbox all sit meaningfully higher at $179–499/mo).
  The earlier lower-entry range (~$29–39/~$59–79/~$129–149) discussed prior to this decision is
  superseded and should not be reopened absent a new, explicit founder decision. If pricing is ever
  revised in the future, use `planCatalogSeed.service.ts`'s existing generational-deactivation
  pattern (`isActive: false` on the old plan document, a new plan document for the new price) rather
  than mutating a live plan's price in place, to preserve existing subscribers' grandfathered terms.

## 5. Marketplace (Uber Eats / DoorDash / foodpanda)

- 🔵 **EXTERNAL INPUT REQUIRED for all three** — see `docs/marketplace-production-onboarding.md` for
  the full per-provider breakdown of exactly what external approval/certification/account-manager
  step is required before any real credentials can exist.
- 🔴 (Only once a provider is actually being activated) set `MARKETPLACE_PROVIDER_MODE=live` plus that
  provider's specific credential env vars. On the default `mock`, production logs a warning (Phase
  83) and, since Phase 85A, refuses mock-mode marketplace webhooks, so no order can be forged with
  the public dev secret.
- 🟡 Launching with zero marketplace providers connected is a fully legitimate, fully supported
  launch configuration — this section is not a blocker for a direct-ordering-only launch.

## 6. Custom domains (white-label)

- 🔵 Custom domains are **verified and saved, but not served** until the edge can route customer
  hostnames and issue certificates for them — see `docs/custom-domains-infrastructure-contract.md`.
  Until `CUSTOM_DOMAIN_CNAME_TARGET` is set, the admin panel says so plainly instead of showing a
  domain as live.

- 🔴 Set `DNS_VERIFIER=node` (not the default `mock`) before any real restaurant is allowed to claim a
  custom domain — the mock verifier reports every domain "verified" without checking real DNS at
  all, a genuine domain-ownership bypass if left on in production. Phase 83 added a one-time
  production warning for this (`dns/index.ts`) but, consistent with every other provider switch
  audited this phase, does not hard-block boot, since a launch with the custom-domain feature simply
  not yet offered is legitimate.
- ✅ Verified: branding suppression (`hideBranding` in `Layout.tsx`) is correctly gated on
  `resolvedVia === "domain"`, which can only be true for a request that actually resolved through a
  verified custom domain — a Starter-plan restaurant reached via the platform's own fallback URL
  keeps its "Powered by" attribution correctly.

## 7. Legal

- See the full report's Legal Readiness section (Workstream I) for the itemized state of Terms,
  Privacy Policy, and Refund Policy pages. Any entity name, address, or jurisdiction-specific legal
  wording is 🔵 **EXTERNAL INPUT REQUIRED** from the founder or counsel — none was fabricated.

## 8. SEO / Metadata

- ✅ Open Graph image (`apps/marketing/public/og-image.png`) exists at correct dimensions with real
  branding, referenced with an absolute URL — built and verified in Phase 82, reconfirmed present
  this phase.
- 🟡 Confirm the production `MARKETING_ORIGIN` is reflected in canonical URLs and the sitemap once the
  real domain is set (mechanically follows from §1's origin configuration — no separate code change
  needed, since these are already derived from the same env values).

## 9. Operations

- 🟡 Confirm an operator/founder actually monitors API logs for the new Phase 83 production warnings
  (mock payment/billing/marketplace/DNS provider warnings) — these are deliberately loud
  `logger.warn()` calls, not alerts wired to any paging system; if nothing reads the logs, the warning
  never reaches anyone.
- 🟡 Confirm a real support/notification email inbox exists behind `CONTACT_NOTIFICATION_EMAIL`
  before launch (currently defaults to a placeholder `hello@garnishtable.local` if unset).
- 🔴 Marketing demo: run `node dist/scripts/provisionProductionDemo.js` (Phase 85A — idempotent;
  creates only the `demo-restaurant` storefront and refuses if a real tenant owns the slug). Never
  run `seed-demo-data.ts` against production. Expired demo-guest cleanup runs automatically every
  hour inside the API (Phase 87, BullMQ job `demo.cleanup_tick`); nothing to schedule.
- 🟡 Menu import runs with `MENU_EXTRACTION_PROVIDER_MODE=live` (the mode is `live`, not `claude` as
  the Phase 83 report said). Keep `ANTHROPIC_MODEL=claude-sonnet-4-5`: the extractor forces
  `tool_choice: {type: "tool"}`, which newer models (Opus 5.5 / Sonnet 5.5) reject, so changing the
  model needs a code change first.

---

## How to use this checklist

Work top to bottom before cutover. Every 🔴 item should be closed before real customer traffic hits
production. Every 🔵 item needs the founder (or a named external party) to act — engineering cannot
close these by writing more code. 🟡 items are safe to defer briefly but should not be forgotten.
