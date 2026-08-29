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

## 2. Owner plan pricing — DECIDED (Phase 34), supersedes the original single-tier "owner" plan

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

## 3. Agency plan pricing — DECIDED (Phase 34), first real volume-tiered structure

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
