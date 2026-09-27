# Production Launch Checklist

Phase 83 — the single operational checklist to run through immediately before and during cutover
to production. Each item states its current status as of Phase 83 and who owns closing it. Items
marked **EXTERNAL INPUT REQUIRED** cannot be resolved by engineering alone.

Legend: ✅ Done · 🔴 Blocking (must close before launch) · 🟡 Non-blocking (safe to launch without,
should close soon after) · 🔵 External dependency.

---

## 1. Infrastructure

- 🔴 Set `NODE_ENV=production` on every deployed API instance. The env schema's `superRefine` block
  (`apps/api/src/config/env.ts`) will refuse to boot if any of the checks below are unmet — this is
  intentional and is the actual enforcement mechanism for most of this section, not just documentation.
- 🔴 Set `CLIENT_ORIGIN`, `ADMIN_ORIGIN`, `MARKETING_ORIGIN`, and `API_PUBLIC_ORIGIN` (the last one
  newly enforced in Phase 83) to the real deployed HTTPS origins — boot fails if any is left on its
  localhost default.
- 🔴 Set `MONGO_URI` to the production replica-set connection string (transactions require a replica
  set — confirmed in earlier phases' audits — a standalone Mongo instance will fail at runtime on
  the first multi-document transaction, not at boot).
- 🔴 Set `REDIS_URL` to the production Redis instance; confirm the running Redis version satisfies
  `checkRedisVersion.ts`'s minimum (BullMQ requires Redis ≥ 6.2 for scripting features used by
  delayed jobs) — this check runs at boot and logs a clear error, but does not hard-block, so verify
  manually too.
- 🟡 Confirm the API process runs under a supervisor (systemd/pm2/container orchestrator) with
  automatic restart on crash — not verified as part of this audit since it's infra-layer, outside
  the repo.

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

- 🔴 Set `PAYMENT_PROVIDER` to `stripe` or `safepay` (not the default `mock`) unless this launch is
  deliberately cash-only — Phase 83 added a boot-time-adjacent warning (`payments/index.ts`) that
  fires the first time the provider is resolved in production if left on `mock`, but it does not hard
  -block, since cash-only is a legitimate launch configuration.
- 🔴 Set the real provider's API keys/webhook secrets for whichever of `stripe`/`safepay` is chosen.
- 🔵 **EXTERNAL INPUT REQUIRED**: confirm the payment provider account itself is out of test/sandbox
  mode and approved for real transactions — this is an account-level setting on the provider's own
  dashboard, not something this codebase can verify.
- 🟡 Confirm `API_PUBLIC_ORIGIN` (see §1) is correct before any restaurant owner connects a real
  payment account via BYOC — the webhook URL shown to them in `restaurantPaymentAccount.controller.ts`
  is built directly from this value.

## 4. Billing (platform SaaS subscriptions)

- 🔴 Set `BILLING_PROVIDER=paddle` (not the default `mock`) — same warn-not-block treatment added in
  Phase 83 (`billing/index.ts`).
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
  provider's specific credential env vars — leaving this on the default `mock` in production now
  produces a one-time warning (Phase 83, `marketplaceProviders/index.ts`) rather than silently
  ingesting fake orders with no signal.
- 🟡 Launching with zero marketplace providers connected is a fully legitimate, fully supported
  launch configuration — this section is not a blocker for a direct-ordering-only launch.

## 6. Custom domains (white-label)

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

---

## How to use this checklist

Work top to bottom before cutover. Every 🔴 item should be closed before real customer traffic hits
production. Every 🔵 item needs the founder (or a named external party) to act — engineering cannot
close these by writing more code. 🟡 items are safe to defer briefly but should not be forgotten.
