# Payment Provider Decision

## Update — Phase 15

`SafepayProvider` (`apps/api/src/payments/SafepayProvider.ts`) now exists and is real,
network-capable code — not a second mock. It was written against what could actually be verified
about Safepay's public API (their real sandbox/production hosts, their secret-key auth model, and
the shape of their hosted-checkout token flow, all confirmed via their own docs/SDK source) plus a
few explicitly-flagged assumptions where their full API reference wasn't reachable without a real
account (exact REST paths, the exact webhook signature header name and JSON field names, and
whether/how refunds work at all — no refund endpoint surfaced anywhere in the reachable
documentation). See that file's header comment for the full verified-vs-assumed breakdown. It has
**never been run against a live Safepay sandbox or production account** — no credentials were
available in this environment. `PAYMENT_PROVIDER=safepay` now requires `SAFEPAY_API_KEY`,
`SAFEPAY_SECRET_KEY`, and `SAFEPAY_WEBHOOK_SECRET` to all be set (`SAFEPAY_ENV` picks sandbox vs.
production, defaulting to sandbox); `getPaymentProvider()` throws a clear config error if any are
missing, rather than starting up in a state that would fail on the first real checkout.

One real architectural fix came out of building this: `PaymentProvider` now has a
`signatureHeaderName` field. The webhook controller used to read one hardcoded header
(`x-payment-signature`) regardless of which provider was configured — harmless for the mock (which
was built to use that name), but wrong for Safepay, whose real webhook header name is not
`x-payment-signature`. The controller now reads whichever header the active provider declares.

**Multi-tenancy model** (Part 4 of the Phase 15 brief): this platform uses **one platform-owned
Safepay account** — a single set of server-only credentials, never per-restaurant secrets. Safepay's
public docs and SDK show no marketplace/connected-account API (unlike, say, Stripe Connect), so
there was no evidence-based alternative to build against. `Restaurant.settings.cashEnabled` /
`onlinePaymentEnabled` (`apps/api/src/models/Restaurant.ts`) are the entire per-restaurant payment
surface — plain booleans, gating whether that restaurant's customers are offered cash/online at
all, never a place a secret is stored or a restaurant-specific provider config is entered. At least
one must stay enabled (enforced in `restaurant.controller.ts`'s `updateRestaurant`, checked against
the restaurant's current stored settings since a partial PATCH body alone can't know if disabling
one would leave the other already off). This was **not** added as a publish-readiness requirement
— cash-only launch remains fully supported without ever touching payment settings.

## Original decision (Phase 14 audit, still the reasoning for choosing Safepay)

**Safepay** is the right first real provider for this platform. What existed before Phase 15 was
the provider-agnostic boundary (`PaymentProvider` interface, `PAYMENT_PROVIDER` env var,
`SAFEPAY_*` config placeholders) and a fully-working **mock provider** that exercises the entire
pipeline — intent creation, signature verification, idempotent webhook processing, refunds —
without moving any real money. That mock remains the default in every environment
(`PAYMENT_PROVIDER=mock`) and is still what this repo's own Jest/Playwright suites run against.

## Why Safepay

This platform's target market is explicitly Pakistan-first (per the phase brief). That single
fact rules out the most obvious "default" choice:

- **Stripe does not support Pakistan** as of 2026 — it isn't in Stripe's supported-country list,
  and while there are informal workarounds (e.g. incorporating a foreign entity), recommending
  that as this platform's payment architecture would mean building against an unstable, indirect
  integration path for every restaurant on the platform. Not a sound foundation.
- **Safepay** is a Pakistan-based gateway built specifically for this market — often described as
  "the Stripe of Pakistan" for its API quality and developer experience. It supports cards, Raast
  (Pakistan's real-time payment rail), JazzCash, Easypaisa, and bank transfer — i.e. the actual
  payment methods Pakistani customers use, not just international card rails. It has documented
  multi-vendor/marketplace integration patterns (relevant to this platform's multi-restaurant
  structure), a hosted-checkout flow (customer payment details never touch this platform's
  servers — see Security below), and webhook-based confirmation, which is exactly the shape
  `PaymentProvider` was designed around.

### What was checked and how

- Searched for Safepay's current (2026) product positioning, supported payment methods, and
  marketplace/multi-vendor support.
- Searched for Stripe's current supported-country list to confirm Pakistan's status rather than
  relying on stale assumptions.
- Did **not** attempt to verify Safepay's exact API contract, webhook payload shape, fee
  structure, or onboarding requirements against real documentation or a sandbox account — that
  requires an actual account/API access this phase doesn't have, and asserting those details
  without verifying them would violate the phase's explicit "do not claim a provider is usable in
  production without verifying its availability and requirements" instruction.

### What would need to happen before Safepay goes live

1. A real Safepay merchant account for the platform (this platform uses one platform-owned
   account, not per-restaurant credentials — see the Phase 15 update above).
2. Verify the actual intent-creation, retrieval, webhook payload, and refund contracts against
   Safepay's real API docs/sandbox/Postman collection — `SafepayProvider.ts`'s own header comment
   lists exactly which pieces are still assumptions, not confirmed facts. Pay particular attention
   to the webhook signature header name and refund endpoint, which had zero documentation coverage
   in what was reachable while building this.
3. ~~Implement `SafepayProvider implements PaymentProvider`~~ — done in Phase 15
   (`apps/api/src/payments/SafepayProvider.ts`), but unverified against a live account (see above).
4. Set `PAYMENT_PROVIDER=safepay` plus real `SAFEPAY_API_KEY` / `SAFEPAY_SECRET_KEY` /
   `SAFEPAY_WEBHOOK_SECRET` (and `SAFEPAY_ENV=production` when ready) — `getPaymentProvider()`
   (`apps/api/src/payments/index.ts`) now constructs a real `SafepayProvider` once all three
   secrets are set; it no longer throws for `safepay` itself, only for a genuinely missing secret.
5. Confirm the mock-only `/mock-complete` route genuinely disappears in that configuration (it's
   conditionally registered — see `routes/payment.routes.ts` — so this should already hold, but
   verify it as part of go-live).
6. Run a real transaction (success, failure, and a refund) against Safepay's sandbox and confirm
   the webhook actually arrives, is signed the way `SafepayProvider.verifyWebhookSignature`
   expects, and the status vocabulary `mapSafepayStatus` maps matches what Safepay really sends —
   before ever pointing this at `SAFEPAY_ENV=production`.

### International expansion

`PaymentProvider` doesn't encode anything Pakistan-specific — a `StripeProvider` (or another
region's gateway) can be added later as a second adapter, selected the same way, without touching
`PaymentService` or any controller. This phase deliberately didn't build one, since there's no
current requirement for it and doing so would be speculative complexity.

## What is real vs. mock today

| Piece | Status |
|---|---|
| Payment domain model, status lifecycle, indexes | Real, fully implemented |
| `PaymentProvider` interface | Real, fully implemented |
| `MockPaymentProvider` | Real code, fake money — deterministic, in-process only, never reachable unless `PAYMENT_PROVIDER=mock` |
| `SafepayProvider` (Phase 15) | Real, network-capable code against Safepay's real hosts — **never run against a live Safepay account**. Treat as unverified until tested against a real sandbox (see the checklist above) |
| Webhook signature verification | Real HMAC verification for both providers — against the mock's own secret for `mock`, against `SAFEPAY_WEBHOOK_SECRET` for `safepay` (header name unverified — see `SafepayProvider.ts`) |
| Idempotency (checkout, webhooks, refunds) | Real, enforced at the database level via unique indexes, not just application logic |
| Restaurant payment-method toggles (`cashEnabled`/`onlinePaymentEnabled`) | Real, Phase 15 — server-enforced at order creation, not just hidden client-side |

No code path in this repository reports a mock or unverified payment as confirmed-working, and no
code path claims Safepay integration has been validated against a real account. `PAYMENT_PROVIDER`
defaults to `mock` in every environment unless explicitly overridden, and selecting `safepay`
without all three `SAFEPAY_*` secrets fails loudly at first use rather than silently falling back.
