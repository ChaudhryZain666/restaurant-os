# Payment Provider Decision

## Update — restaurant-owned payment accounts (BYOC)

The "Per-restaurant payment accounts: not built, deliberately deferred" line in the summary table
below is now out of date for the *money-goes-directly-to-the-restaurant* part of that ask — full
Stripe Connect (OAuth, application fees, a genuine multi-merchant marketplace model) is still not
built and stays a documented future option, but a restaurant can now connect its own Stripe or
Safepay account and have its orders settle directly into it, without that OAuth machinery.

**Why not Stripe Connect**: researched directly against Safepay's complete official docs site
(`safepay-docs.netlify.app`) and confirmed — not just "no evidence found," but checked against the
full documentation navigation — that Safepay has no marketplace/sub-merchant/connected-account API
at all (its "Connect" product is an unrelated P2P personal-payment-link feature). Building real
Stripe Connect would mean two structurally different account models per provider, plus Stripe's own
platform-approval process. Instead: **BYOC** — a restaurant pastes its own already-obtained provider
secret key(s) into an admin settings page (`apps/admin/src/components/PaymentAccountSettingsPanel.tsx`,
under Settings → Payment); the platform then calls that provider's normal API *as* that restaurant,
using their credentials directly. One consistent mechanism for both providers, no OAuth, no Stripe
platform approval needed.

**Architecture**: `apps/api/src/models/RestaurantPaymentAccount.ts` (new collection, one per
restaurant *location* — not per business, mirroring `DomainMapping.ts`'s exact per-location
precedent), credentials encrypted at rest with AES-256-GCM
(`apps/api/src/utils/credentialEncryption.ts`, key from `CREDENTIAL_ENCRYPTION_KEY`).
`apps/api/src/payments/restaurantProvider.ts` resolves a restaurant's own active account and is
checked FIRST in `createPaymentForOrder`/`refundPayment` (`payment.service.ts`), before falling
back to the exact existing pooled/eligibility-engine path unchanged — zero behavior change for any
restaurant that hasn't connected its own account. A restaurant-owned account gets its own webhook
URL (`/webhooks/payments/:provider/:restaurantPaymentAccountId` — pasted by the owner into their
own provider dashboard), since a shared per-provider-name secret can't verify a delivery signed with
a specific restaurant's own secret. Connecting an account synchronously verifies it in the same
request (Stripe: `GET /v1/balance`; Safepay: reuses the tracker-creation call, since no dedicated
account-check endpoint exists) — no separate "verified" stage the way DomainMapping has, since there's
no DNS-propagation-like time gap to wait out here.

**Explicitly still deferred**: full Stripe Connect OAuth/application-fee model; simultaneous
multi-provider-per-restaurant (blocked by the model's own partial unique index by design); automated
credential rotation; restaurant-facing payout/transaction dashboards beyond a status badge and a
masked fingerprint (the restaurant's own Stripe/Safepay dashboard is the dashboard — that's the
point of BYOC).

## Update — Phase 34: the international-expansion adapter, plus a real eligibility engine

Phase 29's "International expansion" section below anticipated this exactly: `StripeProvider`
(`apps/api/src/payments/StripeProvider.ts`) is now real, network-capable code implementing the same
`PaymentProvider` interface Safepay does, added as a second adapter with **zero changes to
`PaymentService` or any controller's business logic** — only the provider-lookup call sites
themselves changed (see below). Built against Stripe's real, entirely-public API reference (no
authenticated-account wall, unlike Safepay/Paddle — see that file's header comment for the full
verified-vs-assumed breakdown), deliberately using Stripe's **Checkout Sessions** API rather than
raw PaymentIntents: a Checkout Session returns a real hosted-checkout `url`, matching this
codebase's existing redirect-based `ProviderIntent.clientSecret` contract exactly (the same one
`OrderPaymentPanel.tsx` already redirects to for any non-mock provider) — raw PaymentIntent
`client_secret` values are not URLs and would need Stripe.js/Elements on the frontend, which nothing
in this codebase integrates. Like Safepay, **`StripeProvider` has never been run against a live
(even test-mode) Stripe account** — no credentials were available when it was written. Unlike
Safepay/Paddle, Stripe test-mode API keys are genuinely self-serve with no business verification
required, so this is the one adapter in this platform that's realistically exercisable without a
long external approval process once `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (test mode) are
supplied.

**Provider registry, not a single singleton.** `getPaymentProvider()`
(`apps/api/src/payments/index.ts`) was a process-wide singleton selected once by `PAYMENT_PROVIDER`
— structurally unable to route two different restaurants to two different providers, even though
the webhook route (`/webhooks/payments/:provider`) was already provider-parameterized. It's now a
small keyed registry (`getPaymentProvider(name?)`), each concrete adapter still built lazily/once
and cached; calling with no argument keeps the exact single-default behavior every existing
deployment/test relies on. `paymentWebhook.controller.ts` now resolves the provider the URL itself
names, rather than comparing against a fixed default's `.name`.

**Country/currency eligibility engine** (`apps/api/src/payments/eligibility.ts`) — plain table-driven
TS config (not a new Mongo model or an admin-editable rules UI, deliberately out of scope this
pass), routing a restaurant to a provider by its stored (free-text, unvalidated — no ISO-3166 enum
exists or was added) `country` field: Pakistan aliases → `safepay`, a short explicit list of
Stripe-unsupported countries → `null` (no eligible provider), everything else → `stripe`. Routing is
**opt-in** via `PAYMENT_ELIGIBILITY_ROUTING` (default `false`): every existing deployment, and every
existing test, keeps today's exact single-default-provider behavior unless a deployment
deliberately turns this on — flipping it on is a real production decision (it means a restaurant
whose country has no eligible configured provider gets a clear "online payment isn't available"
error, correctly, rather than silently misrouting to a provider that doesn't serve that market), not
something that should change behavior merely by adding `STRIPE_*` credentials to the environment.

**Known gap, not addressed this phase**: `payment.service.ts`'s `returnUrl`/`cancelUrl` are built
from `env.CLIENT_ORIGIN` (the platform's own origin), not a restaurant's resolved custom domain
(`DomainMapping`) — a restaurant using white-label checkout would still redirect back through the
platform's own domain after a Stripe/Safepay hosted checkout completes. Flagged, not fixed, since it
touches custom-domain resolution logic outside this phase's scope.

## Update — Phase 34 closure: Stripe and Paddle verified live, Safepay re-verified against docs only

`StripeProvider` and `PaddleBillingProvider` were both run against real sandbox/test-mode accounts
this pass (real credentials supplied): Stripe's `createIntent`/`retrieve`/`refund` were exercised
end-to-end, including a real checkout completion driven by Playwright with Stripe's test card and a
byte-for-byte HMAC verification of a real, live-captured `checkout.session.completed` webhook
payload — the signature algorithm is confirmed correct; the one remaining gap (full webhook
*delivery* into the running app) is blocked by this sandbox's system clock running ~5-6 minutes
behind true UTC, which trips the replay-window check on every real webhook. That check is correct
and stays as-is — a normally-clocked environment won't hit this. See `StripeProvider.ts`. Paddle's
customer endpoints were verified live; verification also found that `PaddleBillingProvider`'s
direct subscription-creation call used a Paddle endpoint that doesn't exist (`POST /subscriptions`
returns HTTP 405 — Paddle's own docs: "You can't create a subscription directly") — this was a real
bug affecting the no-card-trial flow for every owner/agency signup against real Paddle, now fixed by
making trial creation contact no billing provider at all (see `subscription.service.ts`).

No Safepay sandbox account was available this pass. Re-verified `SafepayProvider.ts` against the
official `getsafepay/sfpy-php` SDK's published README (WebSearch/WebFetch, no live account) and
found the webhook signature header was simply wrong: assumed `x-safepay-signature`, actually
`X-SFPY-SIGNATURE` — corrected. A single community integration writeup (a public gist, explicitly
self-described as possibly outdated) suggested the checkout-URL shape and webhook HMAC scheme
(hashing the tracker token alone, not the raw body) might both differ further from what's
implemented — left unchanged pending a real sandbox account, since acting on one uncorroborated,
self-flagged-stale source for either would be a worse bet than the current best-documented guess.
See `SafepayProvider.ts`'s header comment for the full confidence breakdown. **Credential ask**:
`SAFEPAY_API_KEY`/`SAFEPAY_SECRET_KEY`/`SAFEPAY_WEBHOOK_SECRET` (sandbox) — this is the one payment
provider that still cannot be verified further without a real account, since Safepay's full API
reference sits behind an authenticated dashboard with no public Postman collection found.

## Update — Phase 29

Closed the one real code gap the Phase 29 commercial-readiness audit found in this domain: even
with `PAYMENT_PROVIDER=safepay` and real credentials configured, `OrderPaymentPanel.tsx`
(`apps/web`) never actually sent the customer anywhere — it only ever offered the mock-only
"Simulate..." buttons, regardless of which provider was active. Fixed by branching on the created
`Payment.provider` field (already returned on every `createPayment` response, no new field
needed): for `"mock"`, the simulate buttons still render exactly as before (dev/test only, and the
underlying `/mock-complete` route still doesn't exist unless `PAYMENT_PROVIDER=mock`); for any real
provider, the browser is redirected immediately to `clientSecret` (the provider's real hosted
checkout URL). Payment confirmation itself is unchanged — still comes back through the existing
webhook path, this only fixes how the customer physically gets to the provider's page.

This required `CreateIntentInput` to gain `returnUrl`/`cancelUrl` (both required now — every real
provider needs to know where to send the customer back), supplied by `payment.service.ts` as
`${CLIENT_ORIGIN}/orders/:id` — the same order-detail page the customer already lands on after
checkout, so "Paid"/"Unpaid" just resolves correctly once they're back, no new page needed.

Also found (via a third-party integration writeup, not Safepay's own reference docs) that
`SafepayProvider`'s tracker-creation path was `/order/v1/payments` — should be `/order/v1/init` —
and that `redirectUrl`/`cancelUrl` are real, required `checkout.create()` params, now wired through.
Both fixed. This is still one notch below "verified against a live account" (see `SafepayProvider.ts`'s
own header comment for the current confidence level on every remaining assumption) — the refund
endpoint and exact webhook field names remain unconfirmed, same as before.

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
| `SafepayProvider` (Phase 15, doc re-verified Phase 34 closure) | Real, network-capable code against Safepay's real hosts — **never run against a live Safepay account**. Webhook header name corrected against the official SDK's README this pass; everything else still unverified until tested against a real sandbox (see the checklist above) |
| `StripeProvider` (Phase 34, verified live Phase 34 closure) | Real, network-capable code against Stripe's real (entirely public) API, using Checkout Sessions — **run end-to-end against a real test-mode account**: create → real Playwright-driven checkout completion with a test card → paid → real refund, all confirmed. Webhook HMAC verified byte-for-byte correct against a real captured payload; full webhook *delivery* into the running app remains unverified in this sandbox specifically because of clock drift, not a code issue |
| Provider registry (Phase 34) | Real — `getPaymentProvider(name?)` supports more than one concrete provider being configured/cached at once; single-default behavior unchanged when called with no argument |
| Country/currency eligibility engine (Phase 34) | Real routing logic, opt-in via `PAYMENT_ELIGIBILITY_ROUTING` (default off) — static TS config, not yet admin-editable |
| Webhook signature verification | Real HMAC verification for all three providers — against the mock's own secret for `mock`; against `SAFEPAY_WEBHOOK_SECRET` for `safepay` (header name now corrected to `X-SFPY-SIGNATURE` against the official SDK's docs — the HMAC scheme itself still unverified against a live account); against `STRIPE_WEBHOOK_SECRET` for `stripe` (Stripe's documented `t=...,v1=...` scheme, including the replay-window check — HMAC confirmed byte-for-byte correct against a real live-captured webhook payload) |
| Idempotency (checkout, webhooks, refunds) | Real, enforced at the database level via unique indexes, not just application logic — `provider` is a free-text field on every relevant model, so a third provider name needed no schema change |
| Restaurant payment-method toggles (`cashEnabled`/`onlinePaymentEnabled`) | Real, Phase 15 — server-enforced at order creation, not just hidden client-side |
| Customer checkout redirect (Phase 29) | Real — `OrderPaymentPanel.tsx` redirects to the active provider's real `clientSecret` checkout URL for any non-mock provider; simulate buttons only ever render for `mock` |
| Per-restaurant payment accounts | **Built via BYOC** (see "Update — restaurant-owned payment accounts" above) — a restaurant can connect its own Stripe/Safepay account and have orders settle directly into it. The platform-pooled account (Multi-tenancy model above) remains the default and the fallback for any restaurant that hasn't connected one. Full Stripe Connect (OAuth, application fees, a true marketplace model) remains **not built, deliberately deferred** — a separate, larger project from BYOC |

No code path in this repository reports a mock or unverified payment as confirmed-working, and no
code path claims Safepay integration has been validated against a real account. `PAYMENT_PROVIDER`
defaults to `mock` in every environment unless explicitly overridden, and selecting `safepay`
without all three `SAFEPAY_*` secrets fails loudly at first use rather than silently falling back.
