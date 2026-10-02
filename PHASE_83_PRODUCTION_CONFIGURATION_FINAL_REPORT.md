# Phase 83 — Production Configuration & Commercial Readiness — Final Report

> **Errata (Phase 85A).** Three statements below no longer match the code: object storage is
> **required** in production (`storage/index.ts` throws on first use without it; local disk is
> development-only); the menu-extraction mode is `live`, not `claude`; and the Redis version check
> **refuses to boot** below 5.0.0 rather than only warning. Current guidance:
> `docs/production-launch-checklist.md` and `docs/production-architecture.md`.

## 1. Executive Summary

Phase 83 audited GarnishTable's production configuration, billing/commercial architecture, legal
readiness, and domain/SEO finalization against the standard set in Phase 82's own closeout. The
single most consequential finding is a repeated architectural pattern: **six provider-selection
modules default to a mock/fake implementation with no production-time signal if that default is
left in place** — meaning a forgotten environment variable doesn't fail loudly, it silently
"succeeds" with fake behavior. Four of the six were genuine launch risk (payments, billing,
marketplace, custom-domain DNS verification) and have been fixed this phase with a loud one-time
production warning. Two were already safe by design and required no change (POS terminal,
geocoding). A fifth gap — `API_PUBLIC_ORIGIN` allowed to stay on localhost in production, which
would hand real restaurant owners an unreachable webhook URL to paste into their own Stripe/Safepay
dashboard — is now a hard boot-time failure, consistent with how the three sibling origin variables
were already treated.

No pricing was changed. No legal text was invented. No new features, providers, or redesigns were
added. Two new operational documents were created. Nothing was committed.

## 2. Audit Methodology

Every claim below is grounded in a direct read of the current repository state this phase, not
assumed from Phase 81/82's own reports. Where a prior report's finding was reconfirmed rather than
re-derived from scratch (the OG image implementation, the plan catalog's structure), that is stated
explicitly rather than silently re-presented as new work. Live verification was used where
practical: `curl http://localhost:4000/api/v1/public/plans` was run against a live local server to
confirm the actual plan catalog being served, rather than trusting the seed script's source alone.

## 3. Scope Discipline Statement

No new marketplace providers, no portal/POS/storefront/landing-page redesigns, no menu-importer
rewrite, no brand/logo changes, and no architecture changes were made. Every code change this phase
is one of: a pure decision function plus a warning log call, a boot-time validation rule, or a new
documentation file. The two largest files touched by prior phases (`payments/index.ts`,
`billing/index.ts`) each gained under 15 lines of production-safety logic; nothing else in either
file changed.

## 4. Production Environment Audit (Workstream A)

`apps/api/src/config/env.ts`'s Zod schema is the single source of truth for every environment
variable this app reads. Its production-only `superRefine` block now enforces, at boot, that none of
`CLIENT_ORIGIN`, `ADMIN_ORIGIN`, `MARKETING_ORIGIN`, or (new this phase) `API_PUBLIC_ORIGIN` is left
on a localhost default, alongside its pre-existing `EMAIL_PROVIDER` hard-requirement. A production
boot with any of these wrong fails immediately and specifically — this is a hard gate, not a
checklist item that can be silently skipped.

## 5. Anthropic API Configuration (Workstream B)

`ANTHROPIC_API_KEY` gates `MENU_EXTRACTION_PROVIDER_MODE=claude`; with no key set the mode defaults
to `mock`, and Phase 82 already added the equivalent production warning for this exact pattern
(`menuExtraction/index.ts`). No further change was needed or made this phase — reconfirmed only.

## 6. Storage Configuration (Workstream C)

`STORAGE_PROVIDER` defaults to `local` (`LocalDiskStorageService`), appropriate for a single-instance
deployment; a multi-instance production deployment needs an object-storage-backed provider or shared
volume, which is an infrastructure decision outside this codebase's own configuration surface, not a
code defect. No mock/production ambiguity exists here — `local` is an honest, working provider, not a
disguised fake.

## 7. Redis / BullMQ Configuration (Workstream D)

`checkRedisVersion.ts` (added Phase 82) verifies the connected Redis's version satisfies BullMQ's
minimum at boot and logs a specific, actionable error if not — reconfirmed still in place and
covered by its own dedicated test file, passing.

## 8. MongoDB Configuration (Workstream E)

`MONGO_URI` has no production-specific validation beyond being a required, non-empty value — a
deliberate choice, since a connection-string typo is already loudly fatal (the app cannot boot
without a database connection) and doesn't need a second, redundant check. Multi-document
transactions used throughout billing/subscription code require a replica set; this requirement is
documented in `docs/database.md` and now cross-referenced in the new launch checklist (§1).

## 9. Payment Provider Configuration & Production Readiness (Workstream F, part 1)

`PAYMENT_PROVIDER` defaults to `mock`. This phase added
`shouldWarnAboutMockPaymentProviderInProduction(nodeEnv, resolvedProvider)`
(`apps/api/src/payments/index.ts`) and a one-time `logger.warn` fired from `getPaymentProvider()` the
first time it resolves to `mock` in production — loud, not blocking, since cash-only is a legitimate
launch configuration. Webhook signature verification for both real providers
(`StripeProvider`/`SafepayProvider`) was reconfirmed present and covered by passing tests; no change
was needed there.

## 10. Billing Provider Configuration & Production Readiness (Workstream F, part 2)

`BILLING_PROVIDER` defaults to `mock`. The identical pattern was added to
`apps/api/src/billing/index.ts`:
`shouldWarnAboutMockBillingProviderInProduction(nodeEnv, mode)` plus a one-time warning inside
`getBillingProvider()`. `PaddleBillingProvider.verifyWebhookSignature` was reconfirmed to do real
HMAC-SHA256 verification of Paddle's `ts=...;h1=...` signature format with a timing-safe comparison —
this exists and is tested, but has only ever been exercised against Paddle's **sandbox**, per
existing project history; real production webhook delivery remains unproven and is listed as an
external input below (§28).

## 11. Current Commercial Configuration vs Final Input Required (Workstream G)

**Live today** (verified via a direct query against the running local API, not just the seed
script's source): three active plans —

| Plan code | Monthly | Annual |
|---|---|---|
| `owner_starter` | $59.00 | $590.00 |
| `owner_growth` | $99.00 | $990.00 |
| `agency_growth_v2` | $179.00 | $1,790.00 |

This is the founder-approved catalog from Phase 39 (`docs/commercial-decisions.md` §19), still the
only catalog self-serve signup can select from. Two earlier plan generations remain in the database
with `isActive: false` — never deleted, never price-mutated — solely to preserve already-existing
subscribers' original grandfathered terms via `Subscription.planId`'s live FK dereference.

**Not yet decided, and NOT changed this phase**: the founder's own prior planning notes floated a
possible lower-entry restructure (~$29–39 / ~$59–79 / ~$129–149), explicitly flagged as not final.
No code, seed data, or documentation was altered to reflect these numbers — they are recorded here
only as the input still awaited, per the brief's own explicit instruction not to fabricate a pricing
decision. If/when the founder finalizes new pricing, the correct mechanism is the same generational
pattern already used twice: seed new `Plan` documents, set `isActive: false` on the current three
without touching their price fields, and update the self-serve plan list's filter (already
`isActive: true`-scoped everywhere) — no other code path needs to change.

## 12. Trial & Subscription Lifecycle Audit (Workstream H)

`Subscription.status` enum: `trialing → active → past_due → cancelling → cancelled/expired`,
enforced by the schema itself. Verified this phase, not merely assumed:
- A real daily-repeating BullMQ job (`registerTrialReminderJob`, cron `0 9 * * *`, deduped by a fixed
  `jobId` so re-registration on every server restart is idempotent) sweeps subscriptions entering
  their trial-ending window and enqueues a reminder email, with `findOneAndUpdate`-guarded
  concurrency so two ticks/workers can never double-send.
- `payment_failed` → past-due notification and `cancelled`/`expired` → cancellation notification are
  both wired through `billingHistory.service.ts`'s single choke point (`recordBillingHistoryEvent`),
  which itself never fails the triggering webhook/action if the notification enqueue fails ("log and
  swallow," matching `audit.service.ts`'s established convention).
- Agency-inherited entitlements for a managed business with no subscription of its own correctly stop
  the instant the managing agency's own subscription reaches `cancelled`/`expired`, and correctly
  continue through a `cancelling` (scheduled-cancellation) agency subscription — confirmed via
  `agencyEntitlementInheritance.service.test.ts`, passing.

No gaps found in this workstream; it was already solid going into this phase.

## 13. Legal Readiness Audit (Workstream I)

Directly read `TermsPage.tsx`, `PrivacyPage.tsx`, `RefundPolicyPage.tsx`. Every unresolved item is an
explicit, visible `[LEGAL_ENTITY_NAME]` / `[GOVERNING_JURISDICTION]` / `[FOUNDER/LEGAL REVIEW
REQUIRED]` / `[PRIVACY_CONTACT_EMAIL]` / `[BILLING_CONTACT_EMAIL]` bracketed placeholder — never
invented text standing in for a real decision. This phase changed none of this content, per the
explicit no-fabrication rule; the full list of exactly what's still a placeholder is below (§28).

## 14. Production Domain Readiness (Workstream J)

The one genuine code-level gap found: `API_PUBLIC_ORIGIN` had no production localhost check even
though `restaurantPaymentAccount.controller.ts` builds a real, owner-facing BYOC webhook URL directly
from it. Fixed via a new `ctx.addIssue` block in `env.ts`'s existing production `superRefine`,
mirroring the three sibling origin checks exactly. Covered by a new dedicated test and two updated
existing tests (both previously relying on this field's undefended default).

## 15. Domain Cutover Checklist (Workstream J, continued)

Captured as §1 and §8 of the new `docs/production-launch-checklist.md` — every URL-shaped
configuration value (API/web/marketing origins, sitemap, OG image, invitation/reset/verification
email links, webhook return URLs, checkout links) was traced to its source and confirmed to derive
from the same four env-schema-enforced origin values, meaning no separate per-feature cutover step
exists beyond setting those four values correctly once.

## 16. SEO / Metadata Finalization Reconfirmation (Workstream K)

Reconfirmed, not redone: `apps/marketing/public/og-image.png` is a real 1200×630 PNG
(`file` command output verified this phase), referenced via an absolute URL built from the same
`MARKETING_ORIGIN`-derived base in `usePageMeta.ts`. `sitemap.routes.ts` builds each URL from either
the request's own verified custom-domain hostname or the enforced `CLIENT_ORIGIN` fallback — no
hardcoded origin found anywhere in SEO-surface code.

## 17. Marketplace External Onboarding Documentation (Workstream L)

Created `docs/marketplace-production-onboarding.md`: a per-provider (Uber Eats, DoorDash, foodpanda)
breakdown of technical state, capability state, the specific external approval/certification step
required, exactly what owner/founder action is needed, and the evidence required to advance from
ENGINEERING READY → PROVIDER APPROVED → PRODUCTION ACTIVE. No provider has ever advanced past
ENGINEERING READY. foodpanda's own already-disclosed Catalog-API create-vs-sync-only uncertainty is
carried into this document rather than silently dropped.

## 18. White-Label / Custom Domain Readiness (Workstream M)

Traced `hideBranding` from `Footer.tsx` (7 theme variants, same gate in each) back to
`Layout.tsx:105`: `hideBranding={resolvedVia === "domain"}`. Verified this is correct and sufficient
— `resolvedVia === "domain"` can only be true for a request that resolved through an actually
-verified custom domain (never the platform's own fallback `/r/:slug` URL), so a Starter-plan
restaurant without the `custom_domains` entitlement can never have its branding accidentally
suppressed. `DNS_VERIFIER` defaults to `mock`, which reports every domain claim "verified" without
checking real DNS at all — this phase added the same one-time production-warning treatment
(`shouldWarnAboutMockDnsVerifierInProduction`, `dns/index.ts`), and corrected that file's own header
comment, which had incorrectly described a NODE_ENV-conditional default that was never actually
implemented in the schema.

## 19. Email / Notification Production Readiness (Workstream N)

Every email-worthy link in the codebase (`auth.controller.ts`'s password reset/verification,
`staff.controller.ts`/`agencyMembership.controller.ts`'s invitation accept links,
`notification.queue.ts`'s order-tracking and billing-portal links) is built from `env.ADMIN_ORIGIN`
or `env.CLIENT_ORIGIN` — both already hard-enforced non-localhost in production by the existing
`superRefine`. No hardcoded or ad-hoc origin construction was found anywhere in the notification
surface. `resolveAppOrigin()` in `auth.controller.ts` only ever trusts an `Origin` header that
exactly matches one of the two real configured frontends, closing off any spoofed-header
email-link-hijack path. `CONTACT_NOTIFICATION_EMAIL` defaults to a placeholder address
(`hello@garnishtable.local`) if unset — flagged in the launch checklist as a 🟡 item, not a code
defect.

## 20. Broader Mock-Provider Safety Classification (Workstream O)

Every mock-capable provider switch in the codebase, classified this phase:

| Provider | Default | Classification | Action this phase |
|---|---|---|---|
| `PAYMENT_PROVIDER` | `mock` | LAUNCH RISK | Warning added |
| `BILLING_PROVIDER` | `mock` | LAUNCH RISK | Warning added |
| `MARKETPLACE_PROVIDER_MODE` | `mock` | LAUNCH RISK | Warning added |
| `DNS_VERIFIER` | `mock` | LAUNCH RISK | Warning added |
| `MENU_EXTRACTION_PROVIDER_MODE` | `mock` | Already fixed (Phase 82) | None needed |
| `POS_TERMINAL_PROVIDER` | `none` | SAFE by design | None needed |
| `GEOCODING_PROVIDER` | *(no default — optional)* | SAFE by design | None needed |

No cross-cutting rewrite was performed — only the genuinely dangerous subset was touched, per the
brief's own explicit instruction.

## 21. Production Launch Checklist Documentation (Workstream P)

Created `docs/production-launch-checklist.md`, organized by Infrastructure / Security / Payments /
Billing / Marketplace / Custom Domains / Legal / SEO / Operations, each item marked ✅ / 🔴 / 🟡 / 🔵
with a one-line reason. Intended as the literal runbook to step through immediately before cutover.

## 22. Testing & Regression Summary (Workstream Q)

- **Full API Jest suite** (`--maxWorkers=2`): 128 suites, 1620 tests — 3 suites initially reported
  "Connection is closed" (ioredis) failures under parallel contention; re-run in isolation
  (`--maxWorkers=1`), all 3 passed (109 tests), confirming pre-existing flakiness under load, not a
  regression from this phase's changes. **Effective result: 128/128 suites, 1729/1729 tests passing.**
- **New tests this phase**: `billing/index.test.ts`, `payments/index.test.ts`,
  `marketplaceProviders/index.test.ts`, `dns/index.test.ts` (3 tests each, covering the new pure
  decision functions), plus 3 new/updated cases in `config/env.test.ts` for `API_PUBLIC_ORIGIN`.
- **App builds**: `apps/admin`, `apps/web`, `apps/marketing` all built clean (exit code 0). Bundle
  -size warnings (>500kB chunks) are pre-existing and out of this phase's scope.
- **Playwright**: ran the 7 specs most directly touched by this session's changes or most relevant to
  Phase 83's own audit surface — `billing-subscription-lifecycle`, `custom-domain-management`,
  `marketplace-uber-eats-connect`, `legal-pages`, `menu-builder-manual-journey`,
  `marketing-og-image`, `marketplace-order-indicator` — **16/16 tests passed**. The full 70-spec
  Playwright suite was not re-run end-to-end this phase; Phase 82's own closeout already ran the full
  mandatory-journey set, and this phase's code changes (pure functions + logging + one boot-time
  validation rule) touch no UI surface, so the targeted subset is the proportionate regression check.

## 23. Git / Change Control Summary (Workstream R)

`git status` reviewed before and after this phase's work. Every file this phase touched is
accounted for above (§9–§21); no unrelated file was modified, and no pre-existing uncommitted work
from earlier phases (visible in the initial `git status` — `agency.controller.ts`,
`business.controller.ts`, menu-extraction files, etc.) was altered, discarded, or interfered with.
One pre-existing untracked file, `_bgsample.png`, predates this phase and was left untouched.

## 24. New Files Created This Phase

- `apps/api/src/billing/index.test.ts`
- `apps/api/src/payments/index.test.ts`
- `apps/api/src/marketplaceProviders/index.test.ts`
- `apps/api/src/dns/index.test.ts`
- `docs/marketplace-production-onboarding.md`
- `docs/production-launch-checklist.md`
- This report.

## 25. Existing Files Modified This Phase

- `apps/api/src/payments/index.ts` — added the mock-in-production warning.
- `apps/api/src/billing/index.ts` — added the mock-in-production warning.
- `apps/api/src/marketplaceProviders/index.ts` — added the mock-in-production warning.
- `apps/api/src/dns/index.ts` — added the mock-in-production warning; corrected an inaccurate header
  comment.
- `apps/api/src/config/env.ts` — added the `API_PUBLIC_ORIGIN` production-localhost hard check.
- `apps/api/src/config/env.test.ts` — 2 existing tests updated, 1 new test added.

## 26. Known Pre-Existing Flakiness Disclosure

The 3-suite "Connection is closed" ioredis failure under `--maxWorkers=2` (§22) is the same
contention-flakiness class documented across Phases 81/82 — Redis connection-pool pressure from
parallel Jest workers, not a code defect. Disclosed honestly here rather than omitted; resolved by
isolated re-run, per established practice.

## 27. Risks Explicitly Not Addressed (Out of Scope This Phase)

- Multi-instance object storage (Workstream C) — an infrastructure decision, not a code change.
- The full 70-spec Playwright suite was not re-run end-to-end (§22's proportionate-subset reasoning).
- Any bundle-size optimization for the three >500kB chunks flagged by all three app builds — pre
  -existing, unrelated to this phase's scope.
- Metered add-on billing (extra locations/businesses) — already flagged in
  `docs/commercial-decisions.md` §7 as "decision required, not built," unchanged this phase.

## 28. External Inputs Required — Consolidated List

- **Legal**: real legal entity name, governing jurisdiction, privacy/billing contact emails, and a
  finalized refund-policy window — all currently explicit bracketed placeholders.
- **Commercial**: final decision on whether to keep the current $59/$99/$179 catalog or move to a
  lower-entry structure — explicitly not decided by engineering.
- **Payments/Billing**: confirmation the Paddle account is live (not sandbox) and a real production
  webhook delivery has been proven end-to-end — currently unproven.
- **Marketplace**: Uber Eats developer API approval; DoorDash certification (TAM-assisted, no self
  -serve path); foodpanda Account Manager engagement plus a definitive answer on Catalog API
  create-vs-sync-only capability. Full detail in `docs/marketplace-production-onboarding.md`.
- **Operations**: a real, monitored support inbox behind `CONTACT_NOTIFICATION_EMAIL`.

## 29. Launch Blockers — Consolidated List

- 🔴 Every item in `docs/production-launch-checklist.md` marked 🔴 must be closed before real
  customer traffic: production origins, database/Redis connection strings, JWT secrets, and (if
  real payments/billing/marketplace/custom-domains are being offered at launch) their respective
  provider-mode env vars and credentials.
- 🔴 Legal pages must have their bracketed placeholders replaced with real, founder/counsel-approved
  text before public launch — a launch with visible `[LEGAL_ENTITY_NAME]` text is not viable
  regardless of any other readiness.
- No code-level blocker remains unresolved; every code-level gap this phase's audit found has been
  fixed.

## 30. Confirmation That Nothing Was Committed

`git status` at the close of this phase shows the same working-tree modifications and new files
listed in §24/§25 above, all uncommitted. No `git add`, `git commit`, or `git push` was run at any
point during Phase 83.

---

## Final Classification

- **ENGINEERING READY**: YES
- **PRODUCTION CONFIGURED**: NO — real production env values, provider credentials, and infra
  settings (§29) are still required.
- **LEGALLY READY**: NO — legal pages still carry explicit placeholder text pending founder/counsel
  input.
- **COMMERCIALLY READY**: NO — final pricing decision still pending founder input; current catalog
  is live and functional but not yet confirmed as final.
- **PRODUCTION READY**: NO
- **LAUNCH BLOCKERS**: production environment configuration (§29), legal page finalization (§29).
- **EXTERNAL INPUTS REQUIRED**: legal entity/jurisdiction/contacts, final pricing decision, live
  Paddle production verification, Uber Eats/DoorDash/foodpanda approvals, a monitored support inbox
  (§28).
- **PHASE 83 CLOSED**: YES
- **GIT COMMITTED**: NO
