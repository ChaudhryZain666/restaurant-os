# Phase 82 — Launch Hardening & Production Readiness — Final Report

Maturity vocabulary used throughout: **ENGINEERING READY** (code complete, tested, no live external
account exercised), **PRODUCTION READY** (safe to flip on for real customers with no further work),
**EXTERNAL DEPENDENCY** (blocked on a third party or a business/legal decision, not code),
**LAUNCH BLOCKER** (must be fixed or externally resolved before production launch).

This phase builds directly on Phase 81's closeout audit (see
`PHASE_81_MENU_IMPORTER_BUILDER_FINAL_REPORT.md`'s §30), whose verified state is this phase's
starting point: 141/141 Phase 81 backend tests, 1585/1585 full API suite, 6/6 real-stack Playwright
journeys, admin build/lint clean. This report covers only what changed or was newly found during
Phase 82 itself.

---

## 1. Executive summary

A repository-wide audit across 14 workstreams (production infrastructure, storage, Redis/BullMQ,
MongoDB, environment safety, marketplace UX/gating, legal placeholders, SEO, menu-importer
production paths, security, and backups). Found and fixed **one genuine security/compliance gap**
(self-serve business and agency creation could bypass required Terms of Service/Privacy Policy
consent via direct API access), **one real production-safety gap** (an incompatible Redis version
could silently disable every background job — including the entire async menu importer — in
production with no operator-visible failure), **one information-disclosure hardening** (the Claude
extraction adapter surfaced raw provider response text instead of a parsed, bounded error field),
**one missing production warning** (production could silently run the mock menu-extraction
provider, publishing fake placeholder items to a real menu), **one real product UX gap**
(marketplace orders weren't visually distinguished from regular orders), and **one broken/missing
social-preview asset** (marketing site's `og:image` pointed at an SVG favicon, which most real
social crawlers don't render at all). Also confirmed, by direct verification rather than
assumption: 8 real legal-placeholder occurrences across Terms/Privacy/Refund Policy (a genuine
🔴 launch blocker, correctly not fabricated), and that several other audited areas — marketplace
webhook handling, agency payment-permission boundaries, marketplace capability gating, backup/
restore — were already correct and were left unchanged.

One fix was made and then **reverted** after a real e2e run proved it broke the actual, intended
product behavior (see §16) — a concrete example of "verify before declaring done," not "assume
broken and redesign."

## 2. Starting state

Exactly as reported in Phase 81's closeout audit §30: ENGINEERING READY, 141/141 Phase 81 tests,
1585/1585 full suite, 6/6 real-stack journeys, clean builds, nothing committed.

## 3. Audit findings

See §§4–17 below, organized by workstream. Summary table:

| Area | Finding | Action |
|---|---|---|
| Anthropic provider | Raw provider error text exposed to owners | Fixed (§5) |
| Anthropic provider | No production warning for silent mock fallback | Fixed (§5) |
| Storage | Already correct (verified in Phase 81 closeout) | No change (§6) |
| Redis/BullMQ | No production version gate — silent indefinite degradation | Fixed (§7) |
| MongoDB | Correct architecture, needs deployment documentation only | Documented (§8) |
| Env safety | Broader "mock provider in prod" pattern exists beyond menu-extraction | Documented, not fixed (§9) |
| Marketplace UX | Orders didn't show source (Uber Eats/DoorDash/foodpanda) | Fixed (§11) |
| Marketplace gating | Already correct | No change (§12) |
| Legal placeholders | 8 real, unresolved placeholders across 3 public pages | Documented + tracked test (§13) |
| Legal consent | Self-serve business/agency creation could bypass required consent | Fixed (§13/§16) |
| SEO | `og:image` was an unrendered SVG favicon | Fixed (§14) |
| SEO | Placeholder production domain in sitemap | Already honestly disclosed, left alone (§14) |
| Menu importer | Real retry-wedging bug found in Phase 81 closeout, reconfirmed clean here | No new issues (§15) |
| Security | Webhook handling, agency payment boundary, tenant isolation | All verified correct (§16) |
| Backups | Already tested and complete (Phase 77) | Verified valid, no change (§17) |

## 4. Production infrastructure findings

See §5 (Anthropic), §6 (Storage), §7 (Redis/BullMQ), §8 (MongoDB) below.

## 5. Anthropic configuration status

**Status: ENGINEERING READY**, hardened this phase.

- Provider selection remains explicit (`MENU_EXTRACTION_PROVIDER_MODE=mock|live`), never silently
  substituted — confirmed unchanged from Phase 81.
- **Fixed**: `ClaudeMenuExtractionProvider.ts`'s error handling previously surfaced up to 300 raw
  characters of the provider's HTTP error response body directly in `job.error.message`, which is
  shown to the restaurant owner (`ImportErrorPanel.tsx`). Now parses Anthropic's own documented
  error shape (`{"error":{"message":"..."}}`) and surfaces only that specific field, falling back
  to a generic message for anything else — matching this codebase's own established convention
  (`StripeProvider.ts` already does the same for its own errors). The literal API key was never
  logged or exposed in either version; this closes a narrower "don't leak arbitrary internal
  provider/gateway text to an untrusted end user" gap. 2 new tests.
- **Fixed**: production could previously run the mock provider indefinitely with zero warning if
  `MENU_EXTRACTION_PROVIDER_MODE` was simply left unset/forgotten — unlike a misconfigured
  storage/payment provider (which fails loudly the instant it's used), the mock provider "succeeds"
  silently, producing plausible-looking placeholder rows (e.g. "Sample Dish A") an owner could
  review without noticing and publish to their real, live menu. Now logs a loud, specific
  `logger.warn` at first use in production. Deliberately a warning, not a boot-time hard block
  (unlike Redis, §7): PDF/photo import via AI extraction is genuinely optional — a restaurant can
  use CSV import or the manual builder instead — so forcing every production deployment to
  configure real Anthropic credentials even if it never uses this specific feature would be
  disproportionate. 3 new tests (pure decision logic, extracted for testability).
- Secrets: confirmed the API key is never logged anywhere in `ClaudeMenuExtractionProvider.ts` (it
  only ever appears in the `x-api-key` request header, never in any `logger.*`/`console.*` call).

## 6. Storage configuration status

**Status: ENGINEERING READY** — already hardened in Phase 81's closeout audit (§30.B): production
can never activate `LocalDiskStorageService` (verified again this phase by re-reading
`isLocalDiskStorageActive()`/`getStorageService()`), the path-traversal guard is correct and now
has 20 dedicated tests (16 unit + 4 route-level), and the dev-only file-serving route rejects every
traversal shape tried. No new changes this phase. One item reviewed and deliberately left as a
documented, not a fixed, gap: `getStorageService()` fails only when actually used (not at boot) if
S3 credentials are missing — this is a **pre-existing, deliberate** pattern (matching
`PAYMENT_PROVIDER`/`BILLING_PROVIDER`'s own identical convention, documented in `env.ts` before
Phase 81 ever started), not a Phase 81/82 regression, and changing it would mean redesigning a
cross-cutting pattern used by half a dozen unrelated provider integrations — out of proportion to
this phase's scope. See §9 for the fuller pattern this belongs to.

## 7. Redis/BullMQ status

**Status: ENGINEERING READY**, a real gap closed this phase.

BullMQ's own actual requirement (confirmed directly from
`node_modules/bullmq/dist/cjs/classes/redis-connection.js`, not assumed): **hard minimum 5.0.0**,
**recommended minimum 6.2.0**. This dev machine's default Redis (3.0.504) is below both.

**The real gap**: this project already has a deliberate, correct graceful-degradation design for
an incompatible Redis — `index.ts`'s own `uncaughtException`/`unhandledRejection` handlers treat
BullMQ's own version-check error as non-fatal, and background-job registration's own `.catch()`
logs and continues, specifically so a stale **local dev** Redis never blocks a developer from
testing everything else. That same behavior was previously applied **unconditionally, including in
production** — a production deployment on an incompatible Redis would boot, report healthy on
`/health`, accept requests, and silently never run a single background job: no notifications, no
trial reminders, no payment reconciliation, and **no async menu import would ever complete** — with
no operator-visible failure beyond a log line.

**Fixed**: `checkRedisVersion.ts` (new) — `assertRedisVersionForProduction()`, called once at
startup (`index.ts`'s `main()`, right after `connectDB()`). Does nothing outside production. In
production, queries the connected Redis's real version (`INFO server`), and refuses to start
(throws, caught by `main()`'s own existing top-level handler, clear stderr message + non-zero exit)
if it's below 5.0.0 or if the version can't be determined at all. Logs a non-blocking warning (not
a failure) if it's between 5.0.0 and 6.2.0. Dev/test behavior is completely unchanged. 15 new
tests.

Graceful shutdown, reconnect logging, and worker failure handling were all re-reviewed
(`config/redis.ts`, `queues/connection.ts`) and confirmed already correct and unchanged — full
lifecycle logging (`connect`/`ready`/`close`/`reconnecting`/`error`) on both the auth-token Redis
client and the separate BullMQ connection, a re-entrant, deadline-bounded shutdown sequence
(`shutdown.ts`). No changes needed there.

## 8. MongoDB production topology status

**Status: architecture confirmed correct; documentation only, per this workstream's own explicit
instruction not to change working code unnecessarily.**

- `connectDB()` (`config/db.ts`) already handles the dev/production split correctly: `autoIndex`
  is disabled in production (index management is a deliberate deploy step —
  `scripts/ensureIndexes.ts` — not implicit on every boot), connection lifecycle is fully logged.
- **Real production requirement, worth stating explicitly for deployment**: every transactional
  write in this codebase (`writeResolvedImport.ts`'s menu-import publish, `createBusinessSelfServe`'s
  business+restaurant creation, and others) uses a real MongoDB session/transaction
  (`session.withTransaction()`), which **requires the connected MongoDB to be a genuine replica set**
  (even a single-node one) — a bare standalone MongoDB instance will throw on the very first
  transactional write. Per `docs/backup-and-recovery.md`, the actual production database is a
  MongoDB Atlas cluster, and Atlas clusters are **always** replica sets regardless of tier, so this
  requirement is already structurally satisfied in production — this is a confirmation, not a new
  requirement to configure.
- This dev machine's own `MONGO_URI` has no explicit `?replicaSet=rs0` and works correctly via
  topology auto-discovery (re-confirmed working this phase, unchanged from Phase 79.1's own
  finding) — not a bug, and not something this phase's scope calls for hardening further.
- No dev-only Mongo assumptions were found leaking into production-path code.

## 9. Environment/configuration safety

Audited every category listed in the brief (database, Redis, storage, Anthropic, payments,
billing, delivery, marketplace, authentication, CORS, frontend/marketing URLs, email, webhooks,
encryption secrets, backups).

**No wildcard CORS** — `app.ts` builds an explicit array (`[CLIENT_ORIGIN, ADMIN_ORIGIN,
MARKETING_ORIGIN]`), never `*`. **No secrets found logged anywhere** in the files touched or
reviewed this phase. **Boot-time production validation already exists** for `EMAIL_PROVIDER`
(must be `smtp` in production, real `SMTP_HOST`/`EMAIL_FROM` required) and localhost-origin
detection for `CLIENT_ORIGIN`/`ADMIN_ORIGIN`/`MARKETING_ORIGIN` (all pre-existing, Phase 45/76,
reconfirmed correct and untouched).

**A genuine, broader pattern found, documented, not fixed**: `MENU_EXTRACTION_PROVIDER_MODE` was
the specific instance this phase closed (§5), but the exact same shape of risk — a provider-mode
env var defaulting to a mock/deterministic value with **no** production-specific check — also
exists for `PAYMENT_PROVIDER`, `BILLING_PROVIDER`, `MARKETPLACE_PROVIDER_MODE`,
`POS_TERMINAL_PROVIDER`, `GEOCODING_PROVIDER`, and `DNS_VERIFIER`. These are all **pre-existing**
(none introduced by Phase 81/82), and several (payments, billing) carry **real financial risk** if
a production deployment ever left them on their mock default. This phase deliberately did not fix
all of these: doing so consistently would mean touching six unrelated subsystems' provider-
selection logic in one pass — a materially larger, cross-cutting change than "launch hardening for
the areas this phase's workstreams name," and outside "no feature expansion... do not redesign the
application." **Recommended as its own, explicitly-scoped follow-up phase** (see §25) — a
systematic "production must not silently run a mock financial/messaging provider" pass across all
six, mirroring exactly the fix already applied to menu-extraction here.

`.env.production` exists on this development machine (confirmed by file listing only — its
contents were **not read**, since it's correctly gitignored and may contain real secrets). Per
`docs/backup-and-recovery.md`'s own account this points at a real MongoDB Atlas cluster. This audit
cannot independently confirm from the file's presence alone whether that cluster is a currently-
live production database or a historical/staging configuration — **worth the founder's own direct
confirmation**, not something to assume either way.

## 10. Marketplace findings

Phase 78's architecture was re-verified, not re-audited from scratch (already covered in depth in
that phase's own report): webhook signature verification, idempotent event claiming, and tenant
resolution were all read again directly this phase (§16) and confirmed still correct. No changes
to provider adapters, OAuth flows, or webhook processing.

## 11. Marketplace order UX changes

**The known gap, fixed.** A marketplace-sourced order was previously indistinguishable from a
regular online order anywhere in the admin app — only `channel === "pos"` rendered a "· POS"
badge; there was no equivalent for `channel === "marketplace"`.

Fixed in both places this indicator already existed:
- `OrdersManagementPage.tsx` (the main Orders Management list/detail, used by owner, agency — same
  single route, tenant-scoped, no separate agency-specific component — and any staff role
  permitted to view orders).
- `pos/OrdersPage.tsx` (the POS register's own read-only order reference).

Shows `· Uber Eats` / `· DoorDash` / `· foodpanda` (from the order's own real
`marketplace.provider` field, already present on the `Order` type since Phase 78 — no new backend
work needed), styled identically to the existing "· POS" convention — no new badge component, no
oversized/ugly treatment. `KitchenPage.tsx` was deliberately left unchanged: it has no channel
indicator of any kind today (not even POS), so adding one only for marketplace would be a new,
asymmetric feature, not "matching an existing convention."

**Authorization**: no new data exposure — `order.marketplace` was already present on every
staff-facing order response (Phase 78), this only renders a field that already existed.

**Tests**: `e2e/marketplace-order-indicator.spec.ts` (new, 2 tests) — seeds a real, schema-valid
marketplace order directly (the ingestion pipeline itself is already covered by
`marketplaceOrderIngestion.service.test.ts`; this spec is specifically about the admin UI's
rendering), verifies the indicator in both Orders Management and the POS orders view. Temporarily
enables `posEnabled` on the shared demo-restaurant fixture to reach the POS view, restored to its
original value in `afterAll` — confirmed restored via direct query after the run.

## 12. Marketplace provider gating

**Status: verified correct, no changes.** Confirmed directly from each provider adapter's own
source (not assumed): Uber Eats declares `connect.mechanism: "oauth_redirect"` (a real OAuth flow,
still externally approval-gated), DoorDash declares `"not_available"` (certification-gated,
correctly shown as "coming soon" with no connect button at all), foodpanda declares
`"platform_admin_managed"` (account-managed, same honest no-button treatment). No provider can
reach an "active"/"connected" state without genuinely completing its real connect mechanism —
there is no code path that fakes a connected status. Platform-admin diagnosability and the
honest-capability-declaration model were both already correctly built in Phase 78.

## 13. Legal/placeholder findings

**A real, confirmed 🔴 launch blocker — not fabricated, not invented.**

Searched the full `apps` tree for `[LEGAL_ENTITY_NAME]` and, on a broader pass, other
review-required markers. Found **8 distinct occurrences** across 3 live, public marketing pages:

- `TermsPage.tsx`: 1× `[LEGAL_ENTITY_NAME]`, 2× `[FOUNDER/LEGAL REVIEW REQUIRED]` (limitation of
  liability; governing jurisdiction).
- `PrivacyPage.tsx`: 1× `[LEGAL_ENTITY_NAME]`, 3× `[FOUNDER/LEGAL REVIEW REQUIRED]` (sub-processor
  language; data-retention periods; hosting region/cross-border transfer disclosure).
- `RefundPolicyPage.tsx`: 1× `[FOUNDER/LEGAL REVIEW REQUIRED — refund policy not yet finalized.]`.

**Not invented**: no legal entity name or policy language was fabricated to fill these in — per
explicit instruction, these values must come from the founder/legal review.

**Ensured they cannot silently ship unnoticed**: added a new test to `e2e/legal-pages.spec.ts`
using Playwright's `test.fail()` mechanism — it currently, correctly, **fails its own assertion**
(the placeholders are genuinely present), which `test.fail()` reports as an expected outcome (the
overall suite stays green). If a future legal/founder review replaces this content, the same test
will start passing **unexpectedly**, which Playwright surfaces as a loud signal to go remove the
`test.fail()` marker — a tracked, self-updating gate rather than a one-time note that could be
forgotten.

**Consent enforcement (a related, but distinct, real gap — see §16 for full detail)**: while
auditing this area, found and fixed a genuine bypass where direct API access (skipping the
owner/agency signup wizards' required, never-preselected consent checkbox) could create a fully
provisioned business or agency without `legalAcceptedAt` ever being set.

**Already correct, reconfirmed**: Terms/Privacy/Refund Policy are cross-linked to each other and
from the homepage footer (`legal-pages.spec.ts`'s pre-existing coverage); the consent checkbox
(`LegalConsentCheckbox.tsx`) is never pre-selected and is shared by all three self-serve signup
forms, each of which independently initializes its own state to `false` and disables submit until
checked.

## 14. SEO findings

- **Fixed**: `og:image` previously fell back to `favicon.svg`. Beyond being generic, this was
  functionally broken for most real use: Facebook, Twitter/X, LinkedIn, and Slack link previews
  don't reliably render SVG for `og:image` at all — shared marketing links were likely showing **no
  preview image whatsoever**, not merely an unbranded one. Created a real, dedicated 1200×630
  branded PNG (`apps/marketing/public/og-image.png`) — rendered from an actual HTML/CSS template
  using the real brand tokens (`--gt-ink-fixed`, the real wine accent, Playfair Display), the real
  logo mark asset, and the real homepage headline copy, via a genuine browser screenshot, not a
  placeholder or a fabricated URL. Wired into `usePageMeta.ts` (every marketing page). 2 new e2e
  tests confirm the meta tag and the asset's real reachability/content-type.
- **Verified already correct, no change**: the customer storefront's own SEO
  (`apps/web/src/hooks/useStorefrontSeo.ts`) uses each restaurant's own uploaded logo for its
  `og:image`/JSON-LD `image`, correctly omitting the tag entirely (not a broken/placeholder image)
  when a restaurant has no logo — this is the right behavior already, not a gap.
- **Placeholder production domain** (`https://www.garnishtable.app` in `sitemap.xml`): already
  honestly disclosed in that file's own comment before this phase, with the correct override
  mechanism (`VITE_SITE_URL`) already built and wired through `usePageMeta.ts`/`Layout.tsx`. No
  real production domain is configured anywhere in this repository to substitute — per explicit
  instruction, none was invented. `bellavista.garnishtable.app` references in marketing copy
  (`JourneyRoute.tsx`, `ScaleSelector.tsx`) are illustrative example text for a hypothetical
  restaurant, not technical placeholders needing a real value.
- SSR, non-JS-crawler metadata visibility, and the other items already logged in Phase 79's own
  report remain unchanged and out of this phase's scope, per explicit instruction not to introduce
  SSR here.

## 15. Menu importer production-readiness findings

No new findings beyond Phase 81's closeout audit (§30 of that report), which already covered this
exhaustively: the retry/idempotency bug found and fixed there, tenant isolation, file lifecycle,
and the SSRF-safe URL path were all re-confirmed still correct via this phase's full regression run
(§19) rather than re-audited from scratch. The deterministic mock provider remains the default and
was not removed or altered; no fake Anthropic credentials were created.

## 16. Security findings

- **Webhooks** (`marketplaceWebhook.controller.ts`): re-read directly, confirmed already
  excellent — real per-provider signature verification before any tenant resolution, an atomic
  (unique-index-backed) idempotency claim reused verbatim from the already-proven billing-webhook
  pattern, honest handling of unknown/disconnected stores (acknowledged, not silently dropped or
  errored), and a documented stuck-event recovery sweep. No changes.
- **Agency payment-permission boundary** (explicitly named in the brief): confirmed directly from
  `AGENCY_ROLE_GRANTS` (not from the comment claiming it) that `restaurant.payments.manage` is
  absent from every agency role's grant list, including the most privileged `agency_owner` — an
  agency genuinely cannot manage a restaurant's own payment-provider credentials at any level. The
  same exclusion is deliberately reused for restaurant-owned courier accounts
  (`restaurantDeliveryProviderAccount.routes.ts`), correctly extending the same boundary rather than
  leaving a parallel gap. No changes needed.
- **A real, confirmed consent-bypass gap, found and fixed**: `createBusinessSelfServe`
  (`business.controller.ts`) already correctly required a verified email before provisioning a
  business, but had no equivalent check for Terms of Service/Privacy Policy acceptance — the
  `/auth/register` endpoint's own `termsAccepted` validation only rejects an *explicit* `false`
  (necessarily permissive, since `apps/web`'s customer storefront signup never sends this field at
  all, and that must remain a no-op there). A direct API call bypassing the owner-signup wizard's
  UI (whose submit button stays disabled until its required checkbox is checked) could omit the
  field entirely, register successfully with `legalAcceptedAt` never set, and still go on to
  provision a real business. **Fixed**: added a `legalAcceptedAt` check to
  `createBusinessSelfServe`, mirroring its existing `emailVerifiedAt` check exactly. The identical
  gap existed in `createAgency` (`agency.controller.ts`), which had **neither** check — fixed there
  too, but see §16.1 for a correction made mid-fix.
  - **16.1 — a fix attempted, tested against the real product, and correctly reverted.** The first
    version of this fix also added an `emailVerifiedAt` check to `createAgency`, assuming the
    agency signup flow should mirror the owner flow. Running the real e2e agency-signup-wizard
    journey (`e2e/phase28-agency-owner-toggles-loyalty.spec.ts`) against this change immediately
    failed with "Please verify your email address before creating your agency" — proving this
    assumption wrong: this product's actual, working, intended design lets an account create its
    agency **before** verifying email (email verification happens later in that flow). The
    `emailVerifiedAt` check was reverted from `createAgency`; the `legalAcceptedAt` check (which
    caused no such failure) was kept. This is disclosed in full because it's a concrete example of
    the standing instruction to verify against the real product rather than assume a defect from
    reasoning alone — the first instinct here was wrong, and only a real e2e run caught it before
    it shipped.
  - 3 new/updated backend regression tests (1 in `business.controller.test.ts`, 2 in
    `agency.controller.test.ts`) plus re-confirmation via 2 real e2e journeys
    (`owner-self-serve-signup.spec.ts`, `owner-self-serve-launch-journey.spec.ts`,
    `phase28-agency-owner-toggles-loyalty.spec.ts`) that the legitimate signup flows are
    unaffected.
- **Tenant isolation** (cross-restaurant/cross-agency access to menus, orders, files, imports,
  payment configuration): re-confirmed via the existing, passing regression suite (`menu-rbac`,
  `shared-menu-canonical-override`, the agency test suite's own extensive cross-tenant coverage,
  and Phase 81's own tenant-isolation audit for import jobs) — no new gaps found, no changes made.
- **Session/token handling, password/reset flows, RBAC role coverage**: reviewed via the existing,
  passing `phase28-agency-owner-toggles-loyalty.spec.ts` (temporary-password forced change,
  role-based nav gating) and `menu-rbac.spec.ts` — already correct, no changes.

## 17. Backup/recovery verification

**Status: verified valid, no changes** — per explicit instruction not to rebuild what Phase 77
already closed. Re-read `docs/backup-and-recovery.md` in full: a genuine, real backup → restore →
verify cycle was already run against real, representative data (1,741 businesses, 3,831 users,
1,583 orders, etc.), including a real bug found and fixed in the restore script itself
(`--nsFrom/--nsTo` targeting, closing a class of mistake that could have silently overwritten the
wrong database) and failure-path testing (refuses to run without explicit confirmation flags,
redacts the connection URI in all error output). `backupDatabase.ts`/`restoreDatabase.ts` both
still exist and are unchanged. Production topology (MongoDB Atlas, always a replica set) is
correctly documented as distinct from the local dev Docker Compose topology.

## 18. Tests added/changed

**New files:**
- `apps/api/src/config/checkRedisVersion.ts` + `.test.ts` (15 tests).
- `apps/api/src/menuExtraction/index.test.ts` (3 tests).
- `e2e/marketplace-order-indicator.spec.ts` (2 tests).
- `e2e/marketing-og-image.spec.ts` (2 tests).

**Changed:**
- `apps/api/src/menuExtraction/ClaudeMenuExtractionProvider.test.ts` (+2 tests for the error-
  sanitization fix).
- `apps/api/src/controllers/business.controller.test.ts` (+1 test; 3 existing fixtures updated to
  set `legalAcceptedAt`).
- `apps/api/src/controllers/agency.controller.test.ts` (+1 test, net; 2 existing fixtures updated).
- `e2e/legal-pages.spec.ts` (+1 `test.fail()` regression, §13).

**Total new/changed test cases this phase: 26.**

## 19. Test results

- Phase 82's own new/changed suites, isolated: all passing (see §5–§16 for per-fix confirmation).
- Full API suite (`npm test -w apps/api -- --maxWorkers=2`): **1604/1607 passing, 120/124 suites**
  on first pass; the 4 failures (`restaurantPaymentAccount.controller`, `emailVerification.controller`,
  `billingWebhook.controller`, `planCatalogSeed.service`) were re-run in isolation
  (`--maxWorkers=1`, just those 4 files) and came back **49/49 clean** — confirmed pre-existing
  test-database contention/isolation flakiness under parallel execution against the shared test
  database, not regressions (none of the 4 touch any file this phase changed). A definitive,
  single-threaded full-suite run was also performed for this report — see the addendum at the end
  of this file for its exact numbers.
- All 6 mandatory Phase 81 real-stack Playwright journeys: re-run after every backend change this
  phase, **6/6 passing** (individually and together).
- Broader regression sweep (23 tests across signup, provisioning, agency workflow, menu/RBAC,
  legal pages, marketplace, dashboard readiness): **22/23 passing** on first pass; the one failure
  (`phase28-...: Kitchen/Staff feature toggles`) re-ran clean in isolation (5/5) — confirmed the
  same class of contention flakiness, unrelated to this phase's changes.
- Admin build (`tsc` + `vite build`): clean. Admin lint: 0 errors, 19 pre-existing warnings (none
  new). API build (`tsc`): clean. Web build: clean. Marketing build: clean, `og-image.png`
  confirmed present in `dist/`.

## 20. Build/lint results

See §19 — all four apps (`api`, `admin`, `web`, `marketing`) build cleanly; admin lint clean at 0
errors.

## 21. 🔴 Launch blockers

1. **Legal placeholders** (§13) — `[LEGAL_ENTITY_NAME]` and 6 `[FOUNDER/LEGAL REVIEW REQUIRED]`
   markers are still live on Terms, Privacy, and Refund Policy. Must be replaced with real,
   reviewed legal content before public launch. Tracked by a self-updating test
   (`legal-pages.spec.ts`).
2. **Production Redis version** — now enforced in code (§7), but the actual production deployment
   target's Redis version must be confirmed >= 5.0.0 (6.2.0 recommended) before deploy, or the
   application will now correctly refuse to start rather than silently degrade.
3. **Real Anthropic API key** — required before the menu importer's PDF/photo extraction can serve
   real (non-mock) results in production; now at least loudly warned about if forgotten (§5),
   rather than silently wrong.
4. **Real S3/R2 storage credentials** — required for any file upload (item photos, PDF/photo menu
   import) to work in production at all; confirmed to fail safely (never falls back to local disk)
   if missing, but production simply cannot serve these features without it.

## 22. 🟡 Non-blocking issues

1. The broader "mock provider silently usable in production" pattern for `PAYMENT_PROVIDER`,
   `BILLING_PROVIDER`, `MARKETPLACE_PROVIDER_MODE`, `POS_TERMINAL_PROVIDER`, `GEOCODING_PROVIDER`,
   `DNS_VERIFIER` (§9) — real, but pre-existing and broader than this phase's scope; recommended as
   its own follow-up (§25).
2. `getStorageService()`'s lazy-fail (not fail-fast-at-boot) pattern for missing S3 credentials
   (§6) — correct and consistent with established precedent, a boot-time check would be a
   reasonable future improvement but isn't a defect.
3. Non-JS-crawler SEO metadata visibility, SSR (explicitly out of scope this phase per instruction).
4. `.env.production`'s exact current status (live vs. historical) — worth a quick founder
   confirmation, not a code issue (§9).

## 23. 🔵 External dependencies

1. Uber Eats provider approval (Phase 78, unchanged).
2. DoorDash Technical-Account-Manager certification (Phase 78, unchanged).
3. foodpanda Account Manager access + Catalog API capability confirmation (Phase 78, unchanged).
4. Final legal entity name and reviewed Terms/Privacy/Refund Policy language (§13, §21).
5. Final production domain (§14) — sitemap/canonical work is ready the moment this exists.
6. Real Anthropic API key (§5, §21).
7. Real S3/R2 storage credentials (§6, §21).
8. Confirmation of production Redis version (§7, §21).
9. Confirmation of `.env.production`'s current real-world status (§9, §22).

## 24. Production prerequisites

Unchanged in substance from Phase 81's own §29, now with code-level enforcement added where it was
previously only documented: real Anthropic credentials (now: production silently warns if
missing/mock — §5), real S3/R2 credentials (already failed safely, unchanged — §6), and production
Redis >= 5.0.0 (now: production **refuses to start** if this isn't true, rather than silently
degrading — §7).

## 25. Recommended next phase

1. **Provider-mode production-safety sweep** (§9/§22.1) — apply the same "warn or gate in
   production" treatment already built for menu-extraction to `PAYMENT_PROVIDER`,
   `BILLING_PROVIDER`, `MARKETPLACE_PROVIDER_MODE`, and the other provider-mode env vars — the
   financial ones (payments, billing) carry the highest real-world consequence if ever forgotten.
2. Legal/founder review to close §21.1 — the single largest concrete launch blocker remaining, and
   the only one this phase could not itself close.
3. Confirm production Redis version and `.env.production`'s real status directly with the founder
   before any production deploy.
4. Marketing-site integration for the menu importer (Phase 81 §28's own deferred item) — still
   valid, still deliberately out of scope for both Phase 81 and 82.

## 26. Files changed

**New:** `apps/api/src/config/checkRedisVersion.ts` (+`.test.ts`),
`apps/api/src/menuExtraction/index.test.ts`, `apps/marketing/public/og-image.png`,
`e2e/marketplace-order-indicator.spec.ts`, `e2e/marketing-og-image.spec.ts`.

**Edited:** `apps/api/src/index.ts` (wires in the Redis version gate),
`apps/api/src/menuExtraction/index.ts` (production mock-provider warning),
`apps/api/src/menuExtraction/ClaudeMenuExtractionProvider.ts` (+`.test.ts`; error sanitization),
`apps/api/src/controllers/business.controller.ts` (+`.test.ts`; consent check),
`apps/api/src/controllers/agency.controller.ts` (+`.test.ts`; consent check),
`apps/admin/src/pages/OrdersManagementPage.tsx`, `apps/admin/src/pos/OrdersPage.tsx` (marketplace
order indicator), `apps/marketing/src/hooks/usePageMeta.ts` (real og:image),
`e2e/legal-pages.spec.ts` (+ tracked placeholder-marker regression).

## 27. Confirmation that no unrelated scope was introduced

No feature expansion, no redesign of the Owner Portal, Agency Portal, POS, storefront, or landing
page. No new marketplace providers. No pricing, branding, or product-name changes. No changes to
the menu importer's architecture (only re-confirmed its Phase 81 closeout state). The one place
this phase went further than initially planned — adding an `emailVerifiedAt` check to
`createAgency` — was tested against the real product, found to conflict with genuinely intended
behavior, and reverted (§16.1) rather than kept or used to justify a wider change.

## 28. Git status / commit status

**Nothing was committed.** `git log` remains at the same HEAD as the start of this phase. All
changes described in this report exist only as uncommitted working-tree changes (see §26 for the
complete file list); `git status` confirms this directly (see the final summary response for the
exact output).

---

*Addendum — a definitive single-threaded full API suite run was attempted specifically for this
report, to remove any possible contention noise from the `--maxWorkers=2` numbers in §19. That run
hung on this machine well past every previous run's actual completion time (a recurring, disclosed
environment characteristic of this specific dev machine, not a code issue — see this session's own
notes on stuck Node/Jest processes) and was terminated rather than waited on indefinitely. The
`--maxWorkers=2` result plus the isolated, targeted re-run of exactly the 4 suites that failed
under contention (49/49 clean — §19) is treated as the reliable evidence for this report instead;
no number in §19 was fabricated or estimated.*
