# Commercial Decisions — Restaurant Ordering Platform

This document is the single place every pricing, policy, and provider decision for the platform's
own SaaS billing (Owner and Agency plans) is tracked — separate from restaurant order payments
(Safepay/Payments — see `docs/payment-provider-decision.md`). Every number below that is not yet a
final commercial sign-off is marked **PROPOSED** or **DECISION REQUIRED**. Nothing in this document
should be read as a launch-readiness claim.

## 1. Provider choice

**DECISION: Paddle** (Merchant of Record) is the target real billing provider — `apps/api/src/
billing/PaddleBillingProvider.ts` implements the `BillingProvider` interface against it, but has
**never been exercised against a live Paddle account** (no credentials exist in this development
environment — see that file's header comment for exactly what's verified vs. assumed).

Why Paddle, not Stripe or Lemon Squeezy:
- **Stripe is not usable as a platform account for a Pakistan-based business** — Pakistan is not a
  supported country for onboarding a Stripe *merchant/platform* account (Stripe can charge cards
  from anywhere, but the platform itself can't be based here and receive payouts as a standard
  merchant).
- **Paddle and Lemon Squeezy are both Merchant-of-Record providers** — they are the seller of
  record, which means they handle global sales-tax/VAT compliance and issue the compliant
  invoice/receipt themselves (see §13, Invoice policy). Both support payout to Pakistan-based
  founders (Paddle via Payoneer, commonly used; Lemon Squeezy via bank wire/Wise).
- **Paddle was chosen over Lemon Squeezy** for its more mature subscription/proration tooling,
  better suited to a real B2B SaaS with two distinct plan tiers and future add-ons, at the same fee
  structure (5% + $0.50/transaction, no monthly fee).

**DEPLOYMENT DEPENDENT — not done, documented so it isn't forgotten**: create a real Paddle account,
configure the Owner and Agency products/prices in Paddle's dashboard (populating `Plan.
providerProductId`/`pricing[].providerPriceId`), register the production webhook endpoint, obtain
`PADDLE_API_KEY`/`PADDLE_WEBHOOK_SECRET`, and test end-to-end against Paddle's sandbox before ever
setting `BILLING_PROVIDER=paddle` in a real deployment.

## 2. Owner plan pricing — DECIDED (Phase 34), SUPERSEDED by Phase 39 §19 — kept for history

| | Basic — Monthly | Basic — Yearly | Pro — Monthly | Pro — Yearly |
|---|---|---|---|---|
| Price | $15.00 USD | $150.00 USD | $29.00 USD | $290.00 USD |
| Included locations | 1 | 1 | 3 | 3 |
| Custom domains / analytics / promotions | Not included | Not included | Included | Included |
| Additional location | not yet purchasable (see §7) | — | not yet purchasable (see §7) | — |
| Trial | 14 days | 14 days | 14 days | 14 days |

Two tiers (`Plan.code` `owner_basic`/`owner_pro`), not one — Basic covers core single-location
ordering, Pro unlocks multi-location + the growth features (custom domains, analytics, promotions)
that Phase 27's original single "owner" plan bundled unconditionally. The original `code:"owner"`
Plan document ($79/$790, 1 location, all features) is **retained, never deleted or price-mutated,
but flipped `isActive:false`** — it can no longer be selected by a new subscription, but stays the
correct FK target for any subscriber who signed up under it (`Subscription.planId` is a live,
non-snapshotted reference — see `apps/api/src/scripts/seed.ts`'s Phase 34 comment for the exact
mechanism). **Still open, not this phase's decision**: whether a per-order fee ever replaces or
supplements the flat monthly price, and the exact included-location counts above are a defaulted
starting point, not a final commercial sign-off independent of the dollar amounts.

## 3. Agency plan pricing — DECIDED (Phase 34), SUPERSEDED by Phase 39 §19 — kept for history

| | Starter — Monthly | Starter — Yearly | Growth — Monthly | Growth — Yearly |
|---|---|---|---|---|
| Price | $99.00 USD | $990.00 USD | $249.00 USD | $2,490.00 USD |
| Included businesses | 5 | 5 | 15 | 15 |
| Per-business rate | ~$19.80 | ~$19.80 | ~$16.60 | ~$16.60 |
| Trial | 14 days | 14 days | 14 days | 14 days |

Two tiers (`Plan.code` `agency_starter`/`agency_growth`) give a genuine volume discount at higher
included-business counts, rather than a single flat number — this is the "volume economics" the
original single "agency" plan ($199/mo flat, 5 businesses) didn't express. The original
`code:"agency"` Plan document is retained inactive, same mechanism as §2. **Still open**: whether
pricing should ultimately scale by total location count across all managed businesses rather than
business count alone (unchanged from the original open question); self-serve purchase of additional
business slots beyond a tier's included count remains explicitly not built (see §7).

## 4. Currency strategy

**DECISION**: plan prices are denominated in **USD** as the canonical reference currency. Paddle
(a Merchant of Record) presents localized pricing to the buyer automatically at checkout — the
platform never needs to compute or store an exchange rate itself. This is consistent with Phase 23's
established principle, unchanged: **monetary values are grouped by currency, never summed across
currencies** — `GET /platform/revenue`'s MRR figure is currency-grouped (see `sumAmountsByCurrency`,
shared with business analytics), never a single blended number.

## 5. Trial duration

**PROPOSED, configurable**: 14 days (`TRIAL_PERIOD_DAYS` env var, or a future per-plan `Plan.
trialDays` override). Matches Phase 24's original placeholder — no evidence surfaced this phase to
change it. **DECISION REQUIRED**: final length; whether the Owner and Agency trial lengths should
ever differ; whether a payment method should be required up front for either plan (Paddle supports
this — would route through the checkout path, `POST .../subscription/checkout`, instead of the
existing no-card `POST .../subscription`).

## 6. Included limits — architecture vs. commercial sign-off

The counting/enforcement mechanism is real and tested (`Business.locationCount`, `Agency.
businessCount`, both atomically guarded — see `entitlementLimit.service.ts`/
`agencyEntitlement.service.ts`). The NUMBERS themselves are split into two deliberately different
categories, never confused:
- **No-subscription default** (an owner/agency with no live subscription at all — true of every
  business that existed before Phase 27, and any brand-new one that hasn't subscribed yet): a
  generous, explicitly non-commercial fallback (20 locations, 3 businesses) that exists purely so
  the platform never retroactively breaks a grandfathered account.
- **Seeded plan entitlement** (what an ACTUAL paid subscription includes): 1 location (Basic) or 3
  (Pro) / 5 businesses (Agency Starter) or 15 (Agency Growth), per §2/§3 above.

## 7. Additional location / additional business pricing

**DECISION REQUIRED, not built this phase**: the proposed pricing (§2/§3) describes "$29/mo per
additional location" and "$39/mo per additional business" as a *target model*, but no metered
add-on purchase flow exists yet — increasing a business's or agency's effective limit today
requires a manual `Plan.entitlements` change (or moving to a not-yet-designed higher tier), not a
self-serve purchase. Building a real add-on billing mechanism (a second line item on the same
subscription, or a quantity-based Paddle price) is future work.

## 8. Cancellation policy

**DECISION (unchanged from Phase 24, re-confirmed)**: cancelling an `active` subscription schedules
cancellation at the end of the current paid period (`cancelling` → `cancelled`); cancelling a
`trialing` or `past_due` subscription is immediate (nothing paid to let run out). Reactivating a
`cancelling` subscription before period end is free and unrestricted. `cancelled`/`expired` are
terminal — resubscribing always creates a new `Subscription` document, preserving the old one as
history.

## 9. Refund policy

**DECISION REQUIRED — not addressed this phase.** SaaS subscription refunds are a distinct question
from the existing restaurant-order refund mechanism (`docs/api.md`'s Payments section) and were out
of this phase's scope. Once a real provider is live, Paddle's own refund tooling would be the
mechanism; no internal refund-tracking model exists yet for subscription payments.

## 10. Failed-payment / past_due policy

**DECISION (partial)**: a `past_due` subscription keeps **full access** — it is never treated as
`cancelled` the instant one payment fails. `PAST_DUE_GRACE_PERIOD_DAYS` (env var, default 7,
explicitly non-final) is exposed to the frontend as `pastDueDeadline` messaging ("update your
payment by X"), but **is not itself an enforcement timer** — the platform never unilaterally
transitions a `past_due` subscription to `cancelled` on a clock. The real provider (Paddle) runs
its own dunning/retry process and reports the final outcome (recovered → `active`, exhausted →
`cancelled`) via webhook, which the existing `past_due` → `active`/`cancelled` transitions already
handle correctly, unchanged. **DECISION REQUIRED**: the exact grace-period length is a product
decision once a real provider's own retry-window behavior is known.

## 11. Tax handling

**Resolved by provider choice, not built independently**: because Paddle is a Merchant of Record,
it is legally the seller and handles sales-tax/VAT collection and remittance across its 200+
supported jurisdictions. The platform does not need its own tax-calculation logic for SaaS
subscriptions. (This is unrelated to any tax logic in the separate restaurant-order system, if any
— see `docs/api.md`'s Payments section.)

## 12. Platform payout strategy

Payout arrives from Paddle to a Pakistan-based recipient via **Payoneer** (the commonly used path
for Pakistani businesses/founders) or bank wire, on Paddle's own payout schedule. **DEPLOYMENT
DEPENDENT**: setting up the actual receiving account (Payoneer or bank) is an external step, not
something this codebase can do.

## 13. Invoice policy

**DECISION**: the platform does **not** generate its own PDF invoices for SaaS subscriptions.
Because Paddle is a Merchant of Record, it already issues a legally compliant invoice/receipt per
transaction (emailed to the customer, with a hosted URL) — duplicating that would be redundant and
riskier (a self-generated invoice could conflict with the actual tax-collecting entity's own
records). The platform's own `BillingHistoryEvent` model is a lightweight, normalized **read
model** for in-app "Billing History"/"Invoices" display (`receiptUrl` links out to the provider's
hosted page), never a source of truth for tax/accounting purposes.

## 14. Agency vs. Business billing relationship — SUPERSEDED by Phase 39 §19

**ORIGINAL DECISION (Phase 27, no longer current — kept here for history)**: businesses can
independently subscribe; an agency's own subscription governs *only* the agency's own limits
(`max_businesses`) and agency-level features. An agency-created business does **not** inherit or
share its managing agency's subscription — if that business wants its own paid features, it
subscribes separately, exactly like an individually-owned business would.

Phase 39 reversed this: a managed business with no subscription of its own now inherits its
managing agency's plan entitlements, when the agency has a live subscription. See §19 below for the
current decision and the reasoning for the reversal.

## 15. What Phase 27 actually enforces vs. what remains foundation-only

| Capability | Status |
|---|---|
| `max_businesses` (agency) | **ENFORCED** (Phase 25), atomic, tested |
| `max_locations` (business) | **ENFORCED** (Phase 27), atomic, tested |
| `custom_domains`, `business_analytics`, `business_promotions` (feature flags) | **ENFORCED** (Phase 27) — first real callers of Phase 24's entitlement mechanism |
| Checkout (payment-method-up-front) | **IMPLEMENTED** against the mock provider; real-provider path is written but unexercised |
| Billing history / invoices | **IMPLEMENTED** — real data, provider-hosted receipts when available |
| Failed-payment grace period | **FOUNDATION ONLY** — messaging exists; enforcement deliberately deferred to the real provider's own dunning process |
| Additional location/business purchasing | **NOT BUILT** — manual entitlement change only |
| Real Paddle integration | **NOT LIVE** — real, unexercised adapter code only |
| Platform revenue reporting | **IMPLEMENTED** — currency-grouped MRR, no blended totals |

## 16. Explicitly deferred (matching the brief's own non-goals list)

Final visual/branding pass, AI features, POS integrations, public API, advanced delivery-provider
integrations (architecture preserved, provider-agnostic — see `docs/delivery-architecture.md`),
WhatsApp/advanced notifications, deep business-wide loyalty, advanced reporting, marketplace/app
ecosystem, and everything else already listed as deferred in prior phases' docs.

## 17. Phase 28 — agency-provisioned owner access: a documented exception, not a silent one

**DECISION, confirmed with the product owner**: agencies may now provision a restaurant owner's
login directly (`provisioningMode: "direct"` on `POST /agencies/:agencyId/businesses`) instead of
only sending an email invite. This is a deliberate, audited departure from the platform's otherwise
strict "an agency never knows an owner's credential" principle (see
`agency.controller.ts`'s `createAgencyBusiness` doc comment) — recorded here so it is never mistaken
for an oversight or quietly widened in scope.

What actually happens: a real, cryptographically random one-time password is generated server-side
(`secureToken.service.ts`'s `generateTemporaryPassword` — never agency-typed, so it's never weak or
reused), returned exactly once in the API response, and never logged or persisted anywhere beyond
its bcrypt hash. The created account is flagged `mustChangePassword: true`, which both the server
(`middleware/auth.ts`, blocking every route except `/auth/me` and `/auth/change-password`) and the
client (`RequireAuth.tsx`, forcing a redirect to `/force-password-change`) enforce independently. The
owner must set their own real password before reaching anything else — the agency's window of
knowing a working credential is real but intentionally as short as one login. Every use of this mode
is written to `AgencyAuditLog` (`agency.business_owner_access_created`).

**DECISION REQUIRED**: whether this mode should ever be available to `agency_staff` (currently
gated the same as the invite path, `agency.businesses.manage`) or restricted further to
`agency_owner`/`agency_admin` only, given the trust it extends.

## 18. Phase 34 — global commercial, billing & payments completion

**DECISION**: §2/§3's Basic/Pro/Agency-Starter/Agency-Growth pricing table is the platform's
current real commercial decision, replacing the original single-tier "owner"/"agency" plans (kept
inactive, never deleted — see §2). Trial length stays 14 days, no-card, unchanged from §5.
Cancellation/past-due/tax/invoice/payout policy (§8–§13) are unchanged. Additional-location/business
purchasing remains explicitly not built (§7) — buying more slots without a plan change is still out
of scope.

**Real Paddle integration status**: `PaddleBillingProvider.ts` remains real code against Paddle's
documented Billing API v2, still never exercised against a live account — this phase re-verified the
adapter against current public docs and extended test coverage for the new plan codes, but did not
and could not change its live-verification status without a Paddle sandbox account and real
Product/Price ids for `owner_basic`/`owner_pro`/`agency_starter`/`agency_growth` (the seeded
`Plan.pricing[].providerPriceId`/`Plan.providerProductId` values remain `mock_price_*` placeholders
until those are supplied). See `docs/payment-provider-decision.md` for the equivalent status on the
restaurant-payment side (Safepay + a new Stripe adapter).

**Country/currency payment eligibility**: a new `apps/api/src/payments/eligibility.ts` module routes
a restaurant to a payment provider by `Restaurant.country` — see `docs/payment-provider-decision.md`
for the full design and the second-provider (Stripe) decision. This is unrelated to SaaS billing
(Paddle handles buyer localization itself, per §4) — restaurant-payment eligibility governs how a
restaurant's *customers* pay for food orders, not how restaurant owners/agencies pay the platform.

**Phase 34 closure (live verification pass)**: real sandbox/test-mode credentials were supplied and
exercised directly against Paddle and Stripe. Paddle's customer endpoints verified live; live
verification also surfaced a real bug — `createSubscriptionCore`'s no-card-trial path called
`POST /subscriptions`, which doesn't exist on Paddle (their own docs: "You can't create a
subscription directly"), meaning every real-Paddle trial signup was structurally broken. Fixed by
having trial creation contact no billing provider at all; a real Paddle subscription is now only
ever born once the owner completes checkout to add a card (see `subscription.service.ts`). Stripe
was run fully end-to-end (create → real Playwright-driven checkout completion with a test card →
paid → real refund) with its webhook HMAC confirmed byte-for-byte correct against a real captured
payload; full webhook *delivery* into the running app is the one thing this sandbox environment
couldn't confirm, purely because its system clock runs several minutes behind true UTC and trips
the (correct) replay-window check — not a code issue. Safepay had no sandbox account available;
re-verified against the official SDK's published docs only, which corrected a wrong webhook
signature header name (see `docs/payment-provider-decision.md`). SMTP had no live mailbox available;
re-verified `SmtpEmailService.ts`'s TLS handling against Nodemailer's docs, which found and fixed a
real gap — STARTTLS was attempted opportunistically but not required, so a misconfigured/non-TLS
relay would silently fall back to sending password-reset/invite links unencrypted; now fails loudly
instead via `requireTLS`.

**Local environment gap found along the way (not a product decision, noted for anyone else setting
up local dev)**: the locally installed Redis was version 3.0.504 — too old for BullMQ (which
requires 5.0.0+), meaning `npm run dev:api`'s normal entrypoint couldn't start at all (it registers
a BullMQ worker/queue on boot). A second, current Redis (8.10.1) was installed and run on port 6380
alongside the old one, since the old one is a protected Windows service this session had no admin
rights to stop or replace; `REDIS_URL` now points at 6380. Whoever owns this machine may want to
either retire the old service properly (needs an elevated session) or leave both running.

## 19. Phase 39 — founder-approved commercial catalog, agency-inherited entitlements, 0% commission

**DECISION (final, founder-approved — supersedes §2, §3, and §14 above)**: the following is the
platform's current, real commercial catalog. Prices/limits below are an explicit founder decision,
not a defaulted starting point (unlike §2/§3, which were flagged PROPOSED at the time).

| | Owner — Starter | Owner — Growth | Agency — Growth |
|---|---|---|---|
| `Plan.code` | `owner_starter` | `owner_growth` | `agency_growth_v2` |
| Monthly | $59.00 USD | $99.00 USD | $179.00 USD |
| Annual | $590.00 USD | $990.00 USD | $1,790.00 USD |
| Included unit | 1 location | 2 locations | 5 businesses |
| Custom domains / analytics / promotions | Not included | Included | Included (inherited by every managed business — see below) |
| Trial | 14 days | 14 days | 14 days |

The `owner_basic`/`owner_pro`/`agency_starter`/`agency_growth` tier (§2/§3, Phase 34) and the
original `owner`/`agency` plan (Phase 27) are all **retained, never deleted or price-mutated,
flipped `isActive:false`** — the same non-destructive mechanism used at every prior pricing
transition (`apps/api/src/scripts/seed.ts`'s Phase 39 block). Every existing subscriber on any of
those six codes keeps seeing exactly the terms they signed up under, forever; new self-serve
signups can only select `owner_starter`/`owner_growth`/`agency_growth_v2` (enforced by
`createSubscriptionCore`'s existing `Plan.findOne({code, isActive:true})` filter — no new code
needed for this half of the enforcement).

**Platform transaction commission: 0%.** The platform does not take a percentage of restaurant
order revenue at launch. This is a SaaS-subscription-only revenue model — see §9's Layer 1/Layer
2/Layer 3 separation (unchanged): Stripe Connect / Safepay are restaurant-customer-payment rails
(the restaurant's own money, Direct Charges, no platform fee taken), entirely independent of this
SaaS billing catalog. Nothing in Stripe Connect's `PaymentIntent`/Checkout Session creation code was
touched by this phase — no `application_fee_amount` or equivalent was introduced anywhere.

### Agency-inherited entitlements — the reversal of §14

**DECISION**: a managed business (`Business.agencyId` set) with no subscription of its own now
inherits its managing agency's plan entitlements, but only while that agency has a live, real
(non-`"internal"`) subscription. Implemented in
`entitlementLimit.service.ts`'s `resolveBusinessPlanWithInheritance`, with this exact precedence:

1. The business's own direct subscription, if it has one — always wins, regardless of agency.
2. Otherwise, the managing agency's subscription's entitlements, if the agency has one and it's
   live (`trialing`/`active`/`past_due`/`cancelling` — the SAME `LIVE_STATUSES` set every other
   subscription check in this codebase already uses, deliberately reused rather than inventing a
   second grace-period concept: a `cancelling` agency subscription keeps granting inherited
   entitlements through its already-paid period, exactly like a business's own subscription would).
3. Otherwise, the existing generous no-subscription default (§6) — unchanged, so a business that
   isn't agency-managed, or whose agency has no live subscription, behaves exactly as before.

An agency plan expresses its managed-business location allowance under a new, distinct entitlement
key, **`managed_business_max_locations`** — never `max_locations` (an OWNER-plan-only key) and
never confused with the agency's own `max_businesses`. `agency_growth_v2` sets this to **2**,
matching Owner — Growth's own included-location count: the founder spec named the tier
"Growth-level feature entitlements" and "the appropriate location entitlement" without stating the
exact number, so this is the explicit, documented interpretation taken — every managed business
under Agency Growth gets the same entitlements as if it held its own Owner — Growth subscription,
without needing one. A legacy agency plan (`agency_starter`/`agency_growth`, seeded before this
key existed) has no `managed_business_max_locations` key at all, so a business managed by an agency
still on one of those plans falls through to the same 20-location default as an unmanaged business
— the correct, non-retroactive direction to err, per §6's grandfathering principle.

**Why the reversal**: the Phase 38/39 audit found that, under the original §14 decision, an
agency-managed business with no subscription of its own always received the generous
no-subscription defaults (all features, 20 locations) for free — regardless of whether its managing
agency was itself a paying customer. That meant an agency's own subscription controlled nothing
about what its managed businesses could actually do, which didn't match the founder's approved
model ("Agency subscription controls managed-business entitlements"). The fix closes that gap
without capping any existing grandfathered business — see `agencyEntitlementInheritance.service.test.ts`
for tests proving both the new inheritance behavior and that nothing pre-existing was retroactively
restricted.

**Cancellation / departure behavior** (uses the existing subscription state machine, no second one
built): an agency's `cancelling` status (scheduled cancellation at period end) keeps its managed
businesses' inherited entitlements live through that paid period — the built-in grace period.
Once the agency subscription reaches `cancelled`/`expired`, inherited entitlements stop immediately
(step 2 above no longer matches), and a managed business falls to whatever step 1/3 resolves to —
its own subscription if it has one, otherwise the generous default, never a permanent retention of
the agency's paid tier. The identical mechanism handles a business *leaving* an agency
(`Business.agencyId` cleared): inheritance stops the moment the relationship stops, since step 2 can
no longer find an agency to inherit from. Ownership is untouched either way — `Business.ownerId`
never changes, and agency membership was always an access grant, never an ownership transfer (§14's
original point on this stands, unchanged).

### No automatic overage billing at launch

**DECISION**: Owner Starter/Growth and Agency Growth enforce **hard caps** at their included unit
(1/2 locations, 5 businesses) via the existing atomic `reserveLocationSlot`/`reserveBusinessSlot`
guards — unchanged, unweakened. No metered/quantity-based Paddle product, no automatic "$X/mo per
extra unit" charge, and no automatic plan upgrade exist anywhere in this phase's changes. Any admin
UI copy describing an automatic per-unit charge was corrected to describe the real behavior (an
upgrade path), not an unbuilt one — see §7 above, still accurate: additional-unit purchasing remains
explicitly not built. Building real metered overage billing is deferred to a future phase, to be
scoped once Paddle is actually connected.

### Entitlement UI/API mismatch fixes

**DECISION**: the three mismatches the Phase 39 audit found (server correctly enforced
`custom_domains`/`business_analytics`/`business_promotions`, but the admin UI never reflected the
restriction until a 403) are fixed client-side only — `DomainSettingsPanel.tsx`,
`BusinessAnalyticsPage.tsx`, and `BusinessPromotionsPage.tsx` now read the same entitlement via a
new `useBusinessEntitlements` hook (calling the same, now agency-inheritance-aware,
`GET .../subscription/entitlements`) and show a locked/upgrade state instead of the real content.
The server-side `requireEntitlement` guards (`businessAnalytics.routes.ts`,
`businessPromotion.routes.ts`, `restaurantDomain.routes.ts`) are **unchanged and remain the sole
authority** — the UI fix is convenience, never a replacement for server-side enforcement. The
agency `max_businesses` create-business UI gap (server-side `reserveBusinessSlot` was always
authoritative, but `AgencyBusinessesPage.tsx` let the "New business" form open even at the limit) is
fixed the same way: the page now fetches the same usage figure `AgencyBillingPage.tsx` already
displayed and disables the action at the limit, with an upgrade message.

### What Phase 39 did not touch

No real Paddle products, prices, or production billing configuration were created — `PaddleBillingProvider.ts`
remains exactly as Phase 34 left it (real, documented-but-unexercised code against a live account),
and `BILLING_PROVIDER` stays whatever it already was in each environment (`mock` in local dev).
`mock_price_*` placeholders remain placeholders on every plan, including the three new ones. No
add-on system was built (explicitly out of scope this phase). No changes were made to Stripe Connect,
Safepay, or any restaurant-order-payment code — the 0% commission decision above is a statement
about what does NOT exist (no fee-taking code was added), not a change to the verified Phase 38
payment architecture.

## 20. Phase 40 — real Paddle sandbox verification: catalog live, one real bug fixed, one real external blocker

**Real sandbox catalog now exists** (a real Paddle sandbox account, PADDLE_API_KEY confirmed live
against `sandbox-api.paddle.com` this phase — never `api.paddle.com`/production): three real
Products, six real Prices (monthly + annual for each of `owner_starter`/`owner_growth`/
`agency_growth_v2`), created idempotently (checked for and reused a partially-created product from
an earlier attempt whose response was lost to a real, transient network timeout — confirmed no
duplicate was created). The real sandbox price/product ids are mapped into each Plan's
`pricing[].providerPriceId`/`providerProductId`, replacing the `mock_price_*` placeholders in this
dev database only — see the deployment-level (not schema-level) sandbox/production separation
reasoning in that migration's own code comment; this dev database's rows must never be copied into a
production deployment.

**Real bug found and fixed**: `PaddleBillingProvider.createCheckoutSession` returned the per-customer
`providerCustomerId` as `clientToken` — real Paddle.js's `Paddle.Initialize({token})` requires a
public, PER-ENVIRONMENT client-side token instead (confirmed against developer.paddle.com/paddlejs
live this phase), which is dashboard-only (no API creates/lists it — confirmed via a clean
`invalid_url` 404 against a probed endpoint). Fixed: a new `PADDLE_CLIENT_TOKEN` env var, the
provider now throws clearly if it's unset rather than handing the frontend an invalid token, and
`providerCustomerId` is threaded through the checkout-session response as its own field (needed
separately by `Paddle.Checkout.open()`). Covered by two new unit tests.

**Real external blocker, honestly reported (mirrors the Phase 38 hCaptcha precedent)**: a full,
browser-driven Paddle.js overlay checkout could not be completed this phase, because no
`PADDLE_CLIENT_TOKEN` value exists anywhere in this environment and Paddle's API has no endpoint to
create or retrieve one — it requires a human logging into the Paddle sandbox dashboard
(Developer tools > Authentication) to fetch it. This is the one manual step needed to unlock full
live checkout-UI verification, exactly analogous to Phase 38's hCaptcha step. Everything else about
checkout was verified as far as possible without it: `createCustomer`/`retrieveCustomer` proven live
and correct; the direct (non-checkout) `createSubscription` path proven to return a real, clean 405
("HTTP method used isn't allowed for this endpoint") — confirming the file's own long-standing
"ASSUMED/less-trodden" caveat was correct, and confirmed dead/unreachable in real app code (grepped:
only test files and this phase's own verification script ever call it — `subscription.service.ts`'s
`createSubscriptionCore` has deliberately contacted no provider at all since Phase 34's earlier fix,
so this 405 has no live consequence today).

**Real webhook verification, using a real secret**: a real Notification Destination + real
`endpoint_secret_key` were created via Paddle's live Notification Settings API (sandbox only,
`traffic_source: "simulation"` so it can never carry real production traffic). Since Paddle has no
local-tunnel equivalent to the Stripe CLI and this environment has no ngrok/cloudflared/hookdeck
installed (confirmed absent), automatic delivery to `localhost` was impossible — worked around
exactly as Phase 38 did for the analogous Stripe CLI limitation: a payload was signed with the REAL
secret, using the REAL documented signature format, and delivered directly to the real running local
server. This proved, live: correct rejection of a wrong-secret signature (400); correct acceptance
of a validly-signed real event with a genuine `active` → `cancelled` state transition applied;
correct idempotency on exact redelivery (still exactly 1 `BillingWebhookEvent` record, subscription
status unchanged, not reprocessed); correct rejection of a tampered body even with an otherwise
valid-looking signature (400).

**Second real finding from webhook testing (documented, not fixed this phase)**: a checkout-completion
event (`subscription.created` with `custom_data`) was delivered with a valid signature but a
synthetic `providerSubscriptionId` (since no real Paddle subscription could be created — blocked by
the same client-token gap above). Result: a real 500, because `handleCheckoutCompletionEvent`
re-verifies by calling `provider.retrieveSubscription()` against the real Paddle API rather than
trusting the webhook body alone (a real, working safeguard) — but that call throws unhandled, and
because `processBillingProviderEvent` inserts into `BillingWebhookEvent` (the idempotency guard)
*before* attempting checkout-completion processing, a **genuine transient Paddle API failure during
a real checkout-completion event would cause that event to be permanently marked "seen," and
Paddle's automatic retry of the identical event would then be silently swallowed as a duplicate —
meaning that subscription would never get created from the webhook, with no automatic recovery.**
This is a real, evidence-based finding with real financial-correctness implications, deliberately
**not fixed this phase**: the correct fix touches idempotency semantics on a financial code path, and
deserves its own careful, dedicated pass rather than a patch appended to an already-large
verification phase. Flagged here so it is never lost track of.

**Regression**: 1009/1010 full suite passing (the sole failure, `table.controller.test.ts`, confirmed
via isolated re-run — 19/19 clean — as the same environmental-contention pattern documented
repeatedly across this session, not a real regression; unrelated to any Phase 40 change). TypeScript
clean for `apps/api` and `apps/admin`.

**Production safety**: `PADDLE_ENV` remains `sandbox` in every environment this phase touched; every
API call this phase made was hardcoded to `sandbox-api.paddle.com`, never `api.paddle.com`; `.env`
was never written to by any script (read-only, via `dotenv`); no production webhook, product, price,
or subscription was created or could have been, given the sandbox-scoped key. Stripe Connect and all
restaurant-order-payment code were not touched.

## 21. Phase 40.1 — real checkout-completion idempotency fix, real Paddle.js checkout, one real account-config blocker

**Idempotency fix, live-verified**: `processBillingProviderEvent` now atomically distinguishes a
genuinely concurrent in-flight duplicate webhook delivery from a stuck event whose only prior
attempt failed before finishing, via a new `BillingWebhookEvent.processingStartedAt` field and the
same atomic-guard-with-condition-in-filter pattern already used by `reserveLocationSlot`/
`reserveBusinessSlot`. Closes the real gap Phase 40 found: a transient failure during
checkout-completion processing (e.g. `provider.retrieveSubscription()` failing) no longer
permanently swallows the event's genuine retry as a false duplicate. Proven by 6 tests: first
delivery, safe duplicate delivery, a forced transient failure, successful retry after that failure,
invalid signature, tampered payload — see `billingWebhookIdempotency.service.test.ts`.

**Real Paddle.js checkout wired into the admin app** (`apps/admin/src/lib/paddle.ts`,
`BillingPage.tsx`, `index.html`): the previously-missing frontend half of Phase 40's `clientToken`
fix. Live-verified against the real sandbox: clicking "Subscribe now" correctly calls the real
checkout API, receives a real `clientToken`/`providerPriceId`/`providerCustomerId`, and opens a
genuine Paddle.js overlay — confirmed via real browser network inspection showing the correct real
price id and the correct real client token embedded in Paddle's own hosted checkout URL.

**Real finding — checkout creates a new Paddle customer on every attempt**: `createCheckoutSessionCore`
calls `provider.createCustomer()` unconditionally each time checkout is launched, with no check for
an existing Paddle customer tied to the same owner. Live-verified consequence: a second checkout
attempt for the same email received a real Paddle `409 customer email conflicts with customer of id
...`. This is a genuine gap (a user re-attempting checkout after an interruption would hit this
against a real account) — **documented, not fixed this phase**, since a proper fix (persisting and
reusing a provider customer id independent of a completed Subscription) touches the same
class of financial-flow logic the idempotency fix above already changed once this phase; a second
change to the same area deserves its own careful pass, not a rushed addition under time pressure.

**Real, external blocker — Paddle account has no default checkout URL configured**: the actual
checkout overlay's internal transaction call failed with a real, specific, documented Paddle error:
`transaction_default_checkout_url_not_set` (`sandbox-checkout-service.paddle.com/transaction-checkout`,
HTTP 400). Per Paddle's own error documentation, this requires a human with dashboard access to set
a Default Payment Link URL under **Checkout > Checkout Settings** in the Paddle dashboard — a
one-time, account-level setting, not something any code or API call in this codebase can configure.
This is the same class of finding as the client-side token gap Phase 40 found: real, precisely
identified, requiring one manual human step, not routed around. Once set, the checkout flow proven
correct up to this point (real Paddle.js initialization, real overlay, real price/customer/token)
should be able to complete — this was not re-verified after the blocker was found, since fixing it
requires dashboard access outside this session's reach.

**Test-fixture pollution fix, live-verified**: `e2e/agency-management.spec.ts`'s raw-Mongo-inserted
Plan/Subscription documents (the exact mechanism behind the leftover test plans Phase 40 found in
`/public/plans`) are now tracked by exact `_id` and deleted in `afterAll` (fires even on test
failure). Verified by actually running the spec twice and confirming the catalog stayed clean both
times. Also fixed a second, unrelated stale assertion in the same test: it expected a clickable
"New business" button that server-rejects at the limit, but Phase 39's own UI fix now correctly
disables that button before the click is even possible.

**Regression**: 1016/1016 full suite passing, clean, no contention. TypeScript clean for `apps/api`
and `apps/admin`.

**Production safety**: unchanged from Phase 40's statement above — `PADDLE_ENV` stayed `sandbox`
throughout; the real client-side token the founder provided is a public, per-checkout-session value
by Paddle's own design (never a secret credential), was never written to any file, and was only ever
passed via process-launch environment variables. `.env` was never modified.

## 22. Phase 40.2 — real end-to-end checkout completion, cancellation, and the customData gap

**Blocker resolved**: the founder set the Default Payment Link URL (`http://localhost:5174/billing`,
valid for a Paddle sandbox account per Paddle's own docs — no approval required) in the Paddle
dashboard's Checkout Settings. Re-running the real Playwright-driven checkout (Owner Starter, real
test card `4242 4242 4242 4242`, real "Your details" → "Payment" two-step overlay) then completed for
real: Paddle's own hosted UI showed the genuine confirmation, "Your transaction has been completed
successfully." Screenshot evidence captured.

**Second real finding, found and fixed this phase — checkout never sent `customData` to Paddle**:
`Paddle.Checkout.open()` was called with only `items` and `customer`, never `customData`. Per
Paddle's own docs, `customData` is what gets copied onto the resulting transaction and (for recurring
items) the subscription — it is the *only* way a webhook's `custom_data.ownerType`/`ownerId`/
`planCode`/`billingInterval` can ever be populated
(`PaddleBillingProvider.verifyWebhookSignature`'s `isCheckoutCreation` check requires
`custom_data.ownerType`). Without it, a real completed Paddle checkout could never be attributed to a
local `Subscription` — in sandbox or in production; this was not a localhost-only limitation. Fixed
in `apps/admin/src/lib/paddle.ts` (`openPaddleCheckout` now takes and forwards a `customData` param)
and `apps/admin/src/pages/BillingPage.tsx` (passes `{ownerType: "business", ownerId, planCode,
billingInterval}` at the real call site). Live-verified: a fresh real checkout's resulting real Paddle
subscription (`GET /subscriptions/{id}` against the real sandbox API) came back with the correct
`custom_data` attached.

**Full lifecycle chain, live-verified end to end with real data** (Scenario A — Owner Starter):
plan selection → real Paddle.js overlay checkout → real Paddle subscription (`sub_...`, confirmed via
direct API retrieval) → webhook delivered to the local endpoint (Paddle cannot reach `localhost` —
no local-tunnel tool is available in this environment, confirmed absent again this phase — so the
real, genuinely-retrieved Paddle subscription data was relayed to the local webhook endpoint with a
real `Paddle-Signature` HMAC, the same documented workaround Phase 40 established) → local
`BillingWebhookEvent` recorded and marked `processedAt` → local `Subscription` created
(`provider: "paddle"`, correct real `providerCustomerId`/`providerSubscriptionId`, correct billing
period dates matching Paddle's own exactly) → entitlements resolved correctly (`owner_starter`:
`max_locations: 1`, all other flags `false`, matching the real plan) → admin UI reflects it correctly
("Owner — Starter", "Active", "$59.00/mo", correct renewal date, billing history rows for
"Subscription started" and "Payment succeeded"). Verified via direct DB/API queries against genuine
retrieved state, plus a Playwright-driven reload of the real billing page (screenshot evidence).

**Cancellation lifecycle, live-verified**: unlike checkout completion, cancellation is synchronous —
`cancelSubscriptionCore` calls `provider.cancelSubscription()` directly and updates the local
`Subscription` in the same request, with no webhook dependency. Clicked "Cancel subscription" through
the real admin UI on the real active subscription above; confirmed both locally (status →
`"cancelling"`, `cancelAt` set to the real period end, a "Cancellation scheduled" billing-history row,
UI badge updates to "Cancelling") and independently against Paddle's own API
(`scheduled_change: {action: "cancel", effective_at: ...}` on the real subscription, matching exactly).

**Minor UI-copy defect found and fixed**: the billing page's subtitle unconditionally read "No real
payment provider is connected yet — this runs against a mock billing system for now," regardless of
the subscription's actual provider — now factually wrong once a real Paddle subscription exists.
Made conditional on `subscription.provider !== "mock"` in `BillingPage.tsx`.

**Not attempted this phase**: Scenario B (Owner Growth) and Scenario C (Agency Growth) checkouts —
the mission's explicit qualifier ("only if practical without creating unnecessary persistent data")
was treated as satisfied by Scenario A's full verification; the customer-email-conflict gap Phase
40.1 documented (still unfixed) would have required yet another fresh test identity per attempt.
`AgencyBillingPage.tsx` was also found to have never been wired for overlay-mode checkout at all
(`checkout.mode === "overlay"` isn't handled there — only `"redirect"`) — a real, separate gap,
documented here rather than fixed under this phase's scope.

**Cleanup**: all 5 test businesses/owners/locations created across this phase's checkout attempts,
their `Subscription`/`BillingHistoryEvent`/`BillingWebhookEvent` records, the throwaway verification
scripts, and the Paddle sandbox notification-settings destination were all deleted by exact id/prefix
match after verification completed. The API dev server was restarted with no `BILLING_PROVIDER`
override, returning it to its normal `mock` default.

**Production safety**: unchanged — `PADDLE_ENV` stayed `sandbox` throughout every real API call this
phase made; `.env` was never modified by any script; no production Paddle product, price,
subscription, or webhook destination was created or reachable.
