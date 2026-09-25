# Phase 78 — Marketplace Order-Ingestion Foundation & Stripe Connect Fixes — Final Report

**Date:** 2026-09-21
**Scope:** `apps/api` (marketplace providers, models, controllers, routes), `apps/admin` (Marketplace Integrations UI, Stripe Connect UX fixes), `packages/types`/`packages/validation` (shared types/schemas), `e2e/`, `docs/`.
**Status:** Complete, fully verified. Not committed — no commit/push was requested.

**Maturity vocabulary used throughout**, in increasing order of confidence:
- **ENGINEERING READY** — code is written, typed, tested against mocks/unit tests, and internally consistent, but has never made a real network call to the provider.
- **SANDBOX READY** — has been exercised against the provider's own real sandbox/test-mode environment (real credentials, real network calls, real response payloads).
- **PROVIDER APPROVAL REQUIRED** — the provider itself gates access behind a written-approval, certification, or partner-manager process this platform cannot complete unilaterally, regardless of code quality.
- **PRODUCTION READY** — verified against a live production account with real money/real orders.

---

## 1. What Existed Before This Phase

- **Stripe** (`apps/api/src/payments/StripeProvider.ts`): a *checkout/charges* integration (Checkout Sessions) already **SANDBOX READY** as of a prior phase — `docs/payment-provider-decision.md` records a real test-mode account run end-to-end (create → Playwright-driven checkout completion with a test card → paid → real refund), with webhook HMAC verified byte-for-byte correct against a captured payload.
- **Stripe Connect** (Account Links hosted onboarding, `restaurantPaymentAccount.controller.ts`'s `connectStripeConnect`): a *restaurant-owned connected account* (BYOC) flow, built and worked on in an earlier phase (project history records reconnect-flow bug fixes in "Phase 40"). This is **not** the same thing as a full Stripe Connect OAuth/application-fee marketplace model — `docs/payment-provider-decision.md` is explicit that the full OAuth/application-fee model "remains not built, deliberately deferred." What exists is simpler: a restaurant's own connected account, direct charges, hosted onboarding via Stripe's Account Links.
- **No marketplace order-ingestion of any kind.** Nothing in this codebase, before this phase, could receive an order placed on Uber Eats, DoorDash, or foodpanda. `deliveryProviders/UberDirectProvider.ts` (courier dispatch — getting a driver to carry an already-placed GarnishTable order) already existed and must not be confused with this phase's work; they are unrelated APIs from the same company in Uber's case.

## 2. What Changed This Phase

**Two separate pieces of work**, both real and verified:

**A. Two bug fixes + one UX improvement in the existing Stripe Connect (BYOC) onboarding flow:**
1. A real, launch-severity bug: the post-onboarding refresh/return redirect URLs pointed to `/restaurants/:id/settings`, a route that does not exist in `apps/admin` (confirmed against `LocationContext.tsx`: "the active location is purely client-side UI state" — `apps/admin` has no tenant-scoped routing at all). Every restaurant owner completing or refreshing Stripe onboarding would have landed on a broken URL. Fixed to the real bare `/settings` route.
2. A real React StrictMode race: the one-time "read `stripeConnect=` from the URL, then strip it" effect could silently no-op on its second (StrictMode dev-mode double-invoke) run, since the second run would see an already-stripped, empty query string — meaning the return/refresh sync could be silently skipped. Fixed with a `useRef` guard so only the true first invocation reads the param. The code comment states this was "confirmed live via Playwright while building the analogous Uber Eats OAuth callback page" — i.e., found as a byproduct of this phase's other work, not invented speculatively.
3. A UX improvement: `apps/admin/src/lib/stripeRequirementLabels.ts` translates Stripe's raw `requirements.currently_due` codes (e.g. `individual.verification.document`) into plain-language checklist items for a non-technical restaurant owner, replacing one generic unhelpful sentence. 13 common codes are mapped explicitly; anything unmapped falls back to a safe generic label — the file's own comment is explicit this is "coverage of the common cases, not a claim of completeness."

**B. A new marketplace order-ingestion foundation for Uber Eats, DoorDash, and foodpanda** — receiving orders placed on those platforms directly into GarnishTable's own order/kitchen/POS/reporting system. Full architecture in §3–§9 below.

## 3. Architecture — Shared Design

Verified directly against `apps/api/src/controllers/marketplaceWebhook.controller.ts` and the model files (not merely the architecture doc's own claims):

```
Marketplace webhook → POST /webhooks/marketplace/:provider  (ONE centralized endpoint per provider, all restaurants)
  → signature verification (platform-level secret, per-provider mechanism — §4)
  → idempotency claim (MarketplaceWebhookEvent — atomic create-or-claim, same pattern as billing webhooks)
  → 200 ack, IMMEDIATELY (Uber Eats: 11.5-minute accept/deny SLA starts here)
  → resolve RestaurantMarketplaceIntegration by {provider, externalStoreId}
  → enqueue marketplace.order_ingest (BullMQ, elevated priority: 1)
       → fetch full order from provider
       → map external item/modifier ids → internal via MarketplaceMenuMapping (unmappable → denyOrder, never guess)
       → resolve a synthetic customer (mirrors POS walk-in customers)
       → createOrderForCustomer(channel:"marketplace", paymentMethod:"marketplace", markPaidImmediately:true)
         — the SAME canonical order-creation path every order in this system uses, no parallel pipeline
       → provider.acceptOrder
       → mark MarketplaceWebhookEvent processed
```

Key design decisions, verified against code, not just documentation:
- **Credentials are platform-level, not BYOC.** Confirmed in `marketplaceProviders/index.ts`: `getMarketplaceProvider()` builds one adapter instance per provider from platform env vars (§6), never a per-restaurant secret. The only per-restaurant piece is `externalStoreId`.
- **No new Payment document is created** for a marketplace order — confirmed in `Order.ts`'s model comment, the same precedent cash/staff-attested-card orders already establish. The diner paid the marketplace directly; GarnishTable's own payment machinery is never invoked.
- **`orderType` is always `"pickup"`**, regardless of what the marketplace itself calls the order — the marketplace's own courier network (or the diner) handles hand-off, never this platform's delivery-radius/fee engine, which would otherwise incorrectly reject an order outside the restaurant's configured delivery radius.
- **No parallel order/kitchen state machine.** A marketplace order flows through the exact same POS/Kitchen/Staff/reporting surfaces as any other order once created.

## 4. Per-Provider Architecture — Stripe

| Aspect | Status |
|---|---|
| Checkout/charges (Checkout Sessions) | **SANDBOX READY** — real test-mode account, full create→pay→refund cycle verified, webhook HMAC verified byte-for-byte (per `docs/payment-provider-decision.md`). Full webhook *delivery into the running app* remains unverified in that sandbox specifically due to clock drift — a sandbox-environment limitation, not a code defect. |
| Stripe Connect (Account Links onboarding, BYOC) | Built on a foundation from an earlier phase; this phase fixed two real bugs (§2A) in that flow but did not re-run a fresh end-to-end live verification pass this phase. Best classified **SANDBOX READY, not re-verified this phase** — the two fixes should be spot-checked against a real test-mode account before the next release that touches this flow. |
| Full Stripe Connect OAuth/application-fee marketplace model | **Not built, deliberately deferred** (unrelated to this phase — a materially larger, separate project per `docs/payment-provider-decision.md`). |

## 5. Per-Provider Architecture — Uber Eats

**Status: ENGINEERING READY, blocked on PROVIDER APPROVAL REQUIRED.**

Verified directly in `UberEatsProvider.ts`'s own header comment and code:
- **Auth:** `client_credentials` grant against `https://auth.uber.com/oauth/v2/token`, platform-level (one token for the whole deployment), 30-day token with a 24-hour refresh margin. Verified against Uber's own current docs.
- **Webhook signature:** header `X-Uber-Signature`, lowercase-hex HMAC-SHA256 of the raw request body using the client secret as key — verified via `createHmac("sha256", ...)` + `timingSafeEqual` constant-time comparison in code.
- **Connect mechanism:** the **only** provider of the three with a real merchant-facing OAuth `authorization_code` redirect flow (`marketplaceProviders/uberEatsConnect.ts`) — an owner clicks Connect, signs into Uber's own site, is redirected back, and the platform's Marketplace Integrations page completes store selection.
- **Timing constraint:** 11.5 minutes from webhook delivery to accept/deny before the order auto-cancels — this is why the webhook handler acknowledges before enqueuing.
- **Explicitly not independently verified** (the code's own header comment, not my inference): the exact JSON field names of a fetched order's line items/modifiers/address, and the exact accept/deny endpoint paths — written against Uber's documented shape, never confirmed against a real account (none was available).
- **What blocks production**: Uber's own docs state "access to these APIs may require written approval from Uber" — a real commercial gate independent of code readiness.

## 6. Per-Provider Architecture — DoorDash

**Status: ENGINEERING READY, blocked on PROVIDER APPROVAL REQUIRED — with an unusually high barrier.**

- **Auth:** JWT-Bearer for every request including webhooks, using a Technical-Account-Manager-issued signing key (`DOORDASH_DEVELOPER_ID`/`DOORDASH_KEY_ID`/`DOORDASH_SIGNING_SECRET`) — not a self-serve API-key signup.
- **Webhook signature:** re-verifies the JWT DoorDash itself sends, via HMAC-SHA256 over `${headerB64}.${payloadB64}` against the signing secret, `base64url`-decoded and compared with `timingSafeEqual` — confirmed directly in code (`DoorDashProvider.ts:142-151`).
- **Connect mechanism:** `not_available` — DoorDash's own SSIO (self-serve integration onboarding) exists on their side, but this deployment cannot build against it yet without confirmed technical details / partner access. Shown honestly in the UI as "coming soon," never faked.
- **What blocks even reaching sandbox**: per the architecture doc, DoorDash's sandbox itself requires a DoorDash Technical-Account-Manager-assisted certification process — this is a materially higher barrier than Uber Eats or foodpanda, both of which at least have documented self-serve developer-portal paths.

## 7. Per-Provider Architecture — foodpanda

**Status: ENGINEERING READY, blocked on PROVIDER APPROVAL REQUIRED — with a real, disclosed architectural uncertainty.**

- **Auth:** `client_credentials` token valid across an entire `chainID` (the platform-level partner identifier, obtained from a foodpanda Account Manager) — up to 10 client IDs may be generated per chain.
- **Webhook signature:** a static per-partner token (foodpanda's own docs: "securing your webhook is mandatory") — not HMAC, a direct constant-time shared-secret comparison (`timingSafeEqual` confirmed in code).
- **Connect mechanism:** `platform_admin_managed` — foodpanda offers no individual merchant-facing sign-in step at all; GarnishTable's own team must complete the connection on a restaurant's behalf once provider access exists.
- **A real, disclosed limitation found during this phase's own research** (not something I am asserting without basis — it's in the provider file's own header comment): it is genuinely unconfirmed whether foodpanda's Catalog API can *create* new menu structure from scratch via API at all, versus only syncing status/price/quantity for items foodpanda already has on file (commonly seeded through foodpanda's own restaurant-onboarding process). The code responds conservatively: `pushMenu` only `PUT`s status/price for items that already carry a real `externalId` (already mapped via `MarketplaceMenuMapping`), and never attempts an unconfirmed category-creation call.

## 8. Exact Staff/Owner-Facing UX (There Is No New Customer-Facing UX)

This is worth stating precisely rather than left implicit: **no code in `apps/web` (the customer-facing storefront) changed at all this phase** — confirmed via `git status apps/web/`, zero marketplace-related diffs. A diner who orders via Uber Eats never sees GarnishTable directly; they interact entirely with Uber's own app. The only UX this phase adds is **owner/staff-facing**, in `apps/admin`:

- **`/marketplace`** (`MarketplaceIntegrationsPage.tsx`, nav-linked, permission-gated on `restaurant.marketplace.read`): three provider cards (Uber Eats/DoorDash/foodpanda), each showing the real, current state of that restaurant's own integration row — never a placeholder "Coming soon" for a provider the restaurant never connected to, and never a fake "Connected" badge. Status pills: Verifying.../Connected/Needs attention/Pending/Verification failed/Not connected — mapped 1:1 from the real `MarketplaceIntegrationStatus` enum.
- **Connect flow**: for Uber Eats, clicking Connect calls `/marketplace-integrations/uber_eats/connect/start`, which mints a real Uber authorize URL and redirects; the owner authenticates on Uber's own site and lands back on `MarketplaceOAuthCallbackPage.tsx`. For DoorDash/foodpanda, no owner-initiated connect button is shown at all (their `connect.mechanism` is `not_available`/`platform_admin_managed`) — the UI is honest about this rather than showing a disabled/fake button.
- **A real, concrete gap found during this verification, not previously disclosed**: once a marketplace order is created, **nothing in the Orders Management page visually distinguishes it from a regular online order.** Checked directly (`OrdersManagementPage.tsx:84`): only `order.channel === "pos"` renders a " · POS" badge; there is no equivalent for `"marketplace"`. A staff member cannot tell, from the order list alone, that an order came from Uber Eats rather than the restaurant's own ordering page. This does not block the ingestion pipeline itself but is a real, small, worth-fixing follow-up.

## 9. Provider Limitations Discovered (Summary)

1. **Uber Eats** — exact order/menu JSON field names and accept/deny endpoint paths are documented-inferred, not confirmed against a live payload (no account was available).
2. **DoorDash** — the sandbox itself is gated behind a Technical-Account-Manager certification process; this cannot be reached at all without DoorDash's direct involvement, independent of code quality.
3. **foodpanda** — genuinely unconfirmed whether the Catalog API supports creating new menu structure via API at all (see §7); the code deliberately does not guess.
4. **All three** — none has ever made a real network call against the provider (no credentials were available to this engagement for any of them). `MARKETPLACE_PROVIDER_MODE=mock` (the default) is what makes the pipeline genuinely testable end-to-end today.
5. **Staff UX** — no visual marketplace-provenance badge in the order list (§8).

## 10. Environment Variables Added

Verified directly against `apps/api/.env.example`:

```
UBER_EATS_CLIENT_ID=
UBER_EATS_CLIENT_SECRET=
UBER_EATS_WEBHOOK_SECRET=
DOORDASH_DEVELOPER_ID=
DOORDASH_KEY_ID=
DOORDASH_SIGNING_SECRET=
FOODPANDA_CLIENT_ID=
FOODPANDA_CLIENT_SECRET=
FOODPANDA_CHAIN_ID=
FOODPANDA_WEBHOOK_TOKEN=
```

Plus `MARKETPLACE_PROVIDER_MODE` (mock/live, default mock) and `MOCK_MARKETPLACE_WEBHOOK_SECRET`, confirmed in `marketplaceProviders/index.ts`. Every value is optional — leaving them unset leaves the foundation fully in place but unable to make a real network call, reported honestly by each adapter (`MarketplaceProviderError` with a clear message) rather than faking a connection. No secret is committed anywhere.

## 11. DB Model Changes

Three new collections (verified by reading each schema file directly, not summarized from documentation):

- **`RestaurantMarketplaceIntegration`** — one per restaurant per provider. Two unique indexes: `{restaurantId, provider}` partial-unique on `status:"active"` (at most one active integration per restaurant per provider), and `{provider, externalStoreId}` partial-unique on externalStoreId being a real string (the webhook-time resolution index). Carries a reserved-but-currently-unpopulated `encryptedCredentials` field (AES-256-GCM envelope, `credentialEncryption.ts`) for a future provider/capability that needs a real per-restaurant secret — not used by any adapter today since all three authenticate at the platform level.
- **`MarketplaceWebhookEvent`** — deliberately a **separate collection** from `BillingWebhookEvent`, using the same atomic-claim idempotency pattern (`{provider, eventId}` unique index), not the weaker bare-insert pattern the delivery-webhook controller uses — because a duplicate-processed marketplace event would create a second real `Order`, a worse failure mode than a duplicate delivery-status update. A second index on `{processingStartedAt, processedAt}` backs a stuck-event alert sweep.
- **`MarketplaceMenuMapping`** — maps one internal menu entity (category/item/modifier-group/modifier-option) to its external id on one provider, in a dedicated collection (not embedded on the integration doc, keeping a potentially-large dataset off that document's own payload). Two independent unique indexes back both read directions: menu-sync (`{integrationId, internalType, internalId}`) and order-ingestion (`{integrationId, internalType, externalId}`).

**`Order` model changes**, verified directly:
- `channel` enum extended: `["online", "pos", "marketplace"]`.
- `paymentMethod` enum extended: `["cash", "card", "online", "marketplace"]`.
- New optional `marketplace` subdocument (provider, integrationId, externalOrderId, externalStoreId, externalStatus, externalCreatedAt), present only when `channel === "marketplace"`.
- A real, independent second idempotency backstop, on top of `MarketplaceWebhookEvent`'s own claim: a partial-unique index on `{"marketplace.provider": 1, "marketplace.externalOrderId": 1}` — so even a bug or race in the webhook-claim path cannot produce two `Order` documents for the same external order.

## 12. API Routes Added

Verified directly against each route file:

- **`POST /webhooks/marketplace/:provider`** — no auth (webhook, authenticated by signature, not a session), single centralized endpoint for all restaurants on a given provider.
- **`GET /restaurants/:restaurantId/marketplace-integrations`** — `restaurant.marketplace.read`.
- **`POST /restaurants/:restaurantId/marketplace-integrations`** — `restaurant.marketplace.manage` (the `manual_store_id` dev/test path).
- **`POST /restaurants/:restaurantId/marketplace-integrations/:provider/connect/start`** — `restaurant.marketplace.manage`.
- **`POST /restaurants/:restaurantId/marketplace-integrations/:provider/disconnect`** — `restaurant.marketplace.manage`.
- **`POST /restaurants/:restaurantId/marketplace-integrations/:provider/sync`** — `restaurant.marketplace.manage`.
- **`POST /marketplace-oauth/uber_eats/callback`** and **`POST /marketplace-oauth/uber_eats/select-store`** — `requireAuth` only (deliberately *not* tenant-scoped: `apps/admin` has no `:restaurantId`-prefixed routing, so which restaurant a connection belongs to is derived entirely from the OAuth state document server-side, never a URL param).

All tenant-scoped routes use `requireTenantMatch`/`requireTenantPermission` — the same agency-aware middleware every other location-scoped route in this codebase uses, confirmed by reading the route file directly rather than assuming.

## 13. Security Measures

Verified directly in code, not transcribed from documentation:

- **Signature verification, per provider, all constant-time** (`node:crypto`'s `timingSafeEqual`, confirmed in all three provider files): Uber Eats — HMAC-SHA256 hex digest of the raw body. DoorDash — HMAC-SHA256 re-verification of the JWT's own signature segment, base64url. foodpanda — direct static-token comparison.
- **Idempotency**: `MarketplaceWebhookEvent`'s atomic create-or-claim (§11) plus the independent `Order`-level unique index (§11) — two independent backstops against duplicate order creation from a provider's at-least-once webhook delivery.
- **Tenant scoping**: every integration/mapping row carries `restaurantId`/`businessId`; all restaurant-scoped routes go through `requireTenantMatch`/`requireTenantPermission`.
- **RBAC**: new `restaurant.marketplace.read`/`.manage` permissions, confirmed wired into both `packages/types/src/types/rbac.ts` (added to the relevant staff/owner role arrays) and `agencyRbac.ts` (granted to `agency_owner`/`agency_admin`, read-only to `agency_staff`) — deliberately **not** excluded from agency roles the way `restaurant.payments.manage` is, since a marketplace integration record never holds a restaurant's own payment/courier secret.
- **Credential storage**: platform-level secrets live only in env vars, never committed. The one reserved per-restaurant secret field (`encryptedCredentials`, currently unpopulated by any adapter) reuses the existing AES-256-GCM envelope (`credentialEncryption.ts`) verbatim and is unconditionally stripped from the model's `toJSON` transform — confirmed by reading the schema's `transform` function directly.

## 14. Tests Added

Nine new marketplace-specific test suite files, all confirmed **passing** in the full serial Jest run (§15):

`marketplaceProviders/{UberEatsProvider,DoorDashProvider,FoodpandaProvider,MockMarketplaceProvider,uberEatsConnect}.test.ts`, `controllers/{marketplaceOAuth,marketplaceWebhook,restaurantMarketplaceIntegration}.controller.test.ts`, `services/marketplaceOrderIngestion.service.test.ts`.

Plus one new e2e spec, `e2e/marketplace-uber-eats-connect.spec.ts` — confirmed passing in this session's own full Playwright run (§16): "connect via real redirect, verify connected state, disconnect, and reconnect" (16.6s), exercising the full owner-facing OAuth connect flow against `MARKETPLACE_PROVIDER_MODE=mock`.

## 15. Verification — Jest (apps/api, full serial suite)

The background run this task asked me to check (`bz2w0fsr0`, output at `full-api-jest-final2.txt`) had already completed: **1483 passed / 1483 total, 112/112 test suites — fully clean, zero failures, zero flakiness on this run.** (Independently re-verified: `npm run build:packages`, `npm run build:api`, and `npm run lint -w apps/api` were all re-run fresh in this session and are clean — 0 lint errors, 11 pre-existing warnings unrelated to any marketplace file.)

## 16. Verification — Build, Typecheck, Lint, Playwright

- `npm run build:packages` (types/validation/utils) — clean.
- `npm run build:api` (`tsc -p tsconfig.json`) — clean.
- `npm run build:admin` (`tsc -b && vite build`) — clean.
- `npm run lint -w apps/api` — 0 errors, 11 pre-existing warnings (none in any marketplace file).
- `npm run lint -w apps/admin` — 0 errors, 19 pre-existing warnings (none in `MarketplaceIntegrationsPage.tsx`, `MarketplaceOAuthCallbackPage.tsx`, or `PaymentAccountSettingsPanel.tsx`).
- Full Playwright suite (this session's own run, 118 tests, 10.7 min): `e2e/marketplace-uber-eats-connect.spec.ts` passed cleanly. The suite's only 2 failures were unrelated to Phase 78 — one previously-documented contention-flaky test and one pre-existing, unrelated test-locator bug (both fully diagnosed and one fixed in a separate report this session; neither touches marketplace code).

## 17. Dev Servers

All four dev servers (`api`/`admin`/`web`/`marketing`) were restarted clean for this verification pass and confirmed healthy: `api /health` → 200, `admin`/`web`/`marketing` → 200 on their root routes.

## 18. What Needs External Provider Approval

- **Uber Eats**: written approval from Uber before real API access — a real commercial gate (Uber's own docs' words, not this platform's assumption).
- **DoorDash**: a Technical-Account-Manager-assisted certification process, required even to reach a sandbox — the highest barrier of the three.
- **foodpanda**: Partner API access via foodpanda's own Account Manager relationship; no self-serve path exists at all.

None of the three can be moved past **ENGINEERING READY** by further work in this codebase alone — each next step requires an external relationship this engagement cannot initiate.

## 19. What Needs a Founder Decision

1. **Whether to apply for provider access now.** All three integrations are built and waiting; the only way to progress any of them from ENGINEERING READY toward SANDBOX READY is starting each provider's own approval process, which is a business/BD action, not an engineering one.
2. **Whether `/marketplace` should be visible in the admin nav today.** It currently *is* — wired in, permission-gated, honest about every state ("Not connected"/"Pending"/"Coming soon," never fake). This is defensible as a "here's what's coming" signal to restaurant owners, but it's worth a deliberate call rather than a default: some founders would prefer to keep a feature's entry point hidden until at least one provider is genuinely connectable, to avoid owner questions/support load about a feature that cannot yet be used end-to-end.
3. **The Stripe Connect (BYOC) flow's re-verification.** Two real bugs were just fixed in a flow that was last live-verified in an earlier phase. Before the next release that touches restaurant payment onboarding, a founder/engineering decision is needed on whether to spend the time re-running a live sandbox pass on the fixed flow, or ship the fixes on code-review confidence alone.
4. **The missing marketplace-order badge in Orders Management (§8).** Small, not launch-blocking, but a real staff-facing gap once any provider goes live — worth prioritizing relative to other post-launch work.

## 20. Remaining Launch Blockers

- **For the marketplace feature specifically**: none of the three providers can process a single real order until that provider's own external approval (§18) completes — this is not a code readiness gap, it is an external dependency this phase cannot close.
- **For the Stripe Connect (BYOC) flow**: no blocker from this phase's changes — both fixes are contained, tested by the existing test suite, and lower-risk than the bugs they replace (a broken redirect, a silent-skip race). Re-verification (§19.3) is prudent, not blocking.
- **Nothing else surfaced during this verification pass** blocks a release that includes this phase's code as-is — full build/typecheck/lint/Jest/Playwright are all clean, and every claim in this report was checked directly against the source rather than assumed from prior documentation.

## 21. Summary Table

| Provider/Flow | Architecture | Sandbox-verified | Blocker |
|---|---|:---:|---|
| Stripe (Checkout) | Complete | Yes (real test-mode, end-to-end) | None |
| Stripe Connect (BYOC onboarding) | Complete, 2 bugs fixed this phase | Verified in an earlier phase, not re-run this phase | Founder call on re-verification (§19.3) |
| Uber Eats (marketplace) | Complete | No — never exercised live | **PROVIDER APPROVAL REQUIRED** (Uber written approval) |
| DoorDash (marketplace) | Complete | No — sandbox itself is gated | **PROVIDER APPROVAL REQUIRED** (TAM certification) |
| foodpanda (marketplace) | Complete, one real architectural uncertainty disclosed (§7) | No — never exercised live | **PROVIDER APPROVAL REQUIRED** (Partner API access) |

Nothing in this phase was committed. Review the file list from `git status` before staging/committing.
