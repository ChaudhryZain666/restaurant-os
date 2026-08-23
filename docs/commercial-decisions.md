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

## 2. Owner plan pricing — PROPOSED, not final

| | Monthly | Yearly (≈2 months free) |
|---|---|---|
| Price | $79.00 USD | $790.00 USD |
| Included locations | 1 | 1 |
| Additional location | not yet purchasable (see §7) | — |
| Trial | 14 days | 14 days |

Derived from competitor research (ChowNow $119/$229/$328, Popmenu $179/$299/$499, Owner.com up to
$499/mo or a 5%-per-order model) — positioned as an accessible entry price for a newer entrant, not
a copy of any one competitor. **DECISION REQUIRED**: final sign-off, whether to add a mid/high tier,
and whether a per-order fee (like several competitors) makes more sense than a flat monthly price.

## 3. Agency plan pricing — PROPOSED, not final

| | Monthly | Yearly (≈2 months free) |
|---|---|---|
| Price | $199.00 USD | $1,990.00 USD |
| Included businesses | 5 | 5 |
| Additional business | not yet purchasable (see §7) | — |
| Trial | 14 days | 14 days |

Derived from wholesale white-label reseller benchmarks (~$75/location/mo wholesale, commonly
resold at $100–$150+) — an agency managing 5 businesses at this price implies a per-business cost
below typical wholesale-per-location rates, intentionally aggressive to make the agency tier
attractive relative to running 5 separate Owner subscriptions. **DECISION REQUIRED**: final
sign-off; whether pricing should instead scale by total location count across all managed
businesses, not just business count.

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
- **Seeded plan entitlement** (what an ACTUAL paid subscription includes): 1 location / 5
  businesses, per §2/§3 above — a real commercial number, still marked PROPOSED.

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

## 14. Agency vs. Business billing relationship

**DECISION**: businesses can independently subscribe; an agency's own subscription governs *only*
the agency's own limits (`max_businesses`) and agency-level features. An agency-created business
does **not** inherit or share its managing agency's subscription — if that business wants its own
paid features, it subscribes separately, exactly like an individually-owned business would. This
requires no schema change (already how `{ownerType, ownerId}` polymorphism works) — it is a
deliberate choice to keep "who is paying for what" unambiguous, never inferred.

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
