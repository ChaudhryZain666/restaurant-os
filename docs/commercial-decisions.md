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
