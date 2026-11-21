# Paddle Live — launch and rollback runbook

How GarnishTable moves subscription billing from the mock provider to Paddle **Live**, how to verify
it, and how to back out. Every step marked **[approval]** needs the founder's explicit go-ahead.
Nothing in this file is a secret; secret *values* never go in the repository, chat or logs.

## 0. Verified state on 2026-11-21 (supersedes the 2026-10-24 table below)

Read-only checks with the authorized Paddle Live integration and the public production API:

| Item | State | Needed for launch |
| --- | --- | --- |
| Production | `4ffc99b` (`/health`, built 2026-11-06). `BILLING_PROVIDER` is not `paddle` or `lemonsqueezy` (webhook probes). Mongo and Redis up. | Deploy the launch branch (§6.0) |
| Seller onboarding | **Completed** (account setup and automated review). | Done |
| Checkout domain `garnishtable.com` | **Approved** (Apple Pay verified). | Done |
| Checkout domain `app.garnishtable.com` | **`action_required`** since 2026-11-14. Paddle's reviewer saw an empty page behind a login wall, and `robots.txt` blocked crawlers. Fixed on the launch branch (public description, policy links, `robots.txt` allows `/` and `/login`). | Not needed for **new** customers: pay-now runs on `garnishtable.com/checkout`. Still needed for in-app upgrades from a trial (`app.garnishtable.com/billing`). After the deploy, reply to Paddle's email. |
| Live catalog | 3 products and 6 prices, made in the dashboard on 2026-11-14. USD, `saas`, monthly and yearly, no Paddle trial, amounts match the plans. They have **no `custom_data`**. | Load them with `docs/paddle-live-prices.json` (§6 step 2) |
| Webhook destinations | **None.** | **Founder:** create one (§4) |
| Client-side tokens | **None.** | **Founder:** create one (§3) |
| Default payment link | **Not set.** | **Founder:** set it to `https://garnishtable.com/checkout` once the launch branch is deployed (§5.1) |
| Statement descriptor | Not "GARNISHTABLE". | **Founder:** change it |
| Display name and website | Not set. | **Founder:** set them to GarnishTable and `https://garnishtable.com` |
| API keys | One active key, created 2026-10-23: the key that was shared in chat. | **Founder:** create a new key, put it in `api.env`, then revoke the old one |
| Customers, transactions, subscriptions | 0, 0, 0. | — |

**Do not run `createPaddleCatalog` against Live.** It matches products by `custom_data.internalPlanCode`, which the dashboard products don't carry, so it would plan a second catalog. Since 2026-11-21 it refuses to do that. Use the committed mapping file instead. `setPaddlePriceIds` checks every id directly against Paddle (status, product, amount, currency, cycle, no trial), and webhooks find plans by price id and by the checkout's own `custom_data`, so product `custom_data` isn't needed.

Status as of **2026-10-24** (read-only checks via the authorized Paddle Live integration and the
public production API):

| Item | Verified state |
| --- | --- |
| Production billing | `BILLING_PROVIDER` is not `paddle` (`POST /api/v1/webhooks/billing/paddle` → "not configured for billing provider"); mock webhook → 404. Production image `b6b0f3e` (2026-10-10). |
| Live seller onboarding | **Pending** — all four steps pending since 2026-08-28: `account_setup`, `domain_review`, `identity_verification`, `final_review`. |
| Live checkout domain | `garnishtable.com` — `pending_review`. |
| Live catalog | Empty: 0 products, 0 prices. |
| Live webhook destinations | None. |
| Live client-side tokens | None. |
| Live customers / transactions / subscriptions | 0 / 0 / 0. |
| Live default payment link | Not set. |
| Live statement descriptor | Set, but derived from the account holder's name, **not** "GarnishTable". |
| Live account display name / website | Not set. |
| Live tax mode | `location`; balance currency USD. |
| Sandbox catalog | Complete and correct (below); used by all sandbox tests T1–T10. |

## 0.1 Pay-now checkout (added 2026-11-21)

New customers can pay without a trial and without an account first, on **`https://garnishtable.com/checkout`**. The pricing page links to it with "Pay now — no trial".

1. The buyer picks Owner Starter or Growth, monthly or annual. `POST /api/v1/public/checkout` records a checkout intent and returns the Paddle price, client token and a one-time set-up token.
2. Paddle's overlay takes the email and card. Its custom data carries only the intent id.
3. The signed `subscription.created` webhook marks the intent **paid**. The plan is taken from the subscription's price, never from the browser. The customer is emailed a set-up link (`app.garnishtable.com/claim#token=…`). The browser's "completed" event never grants anything.
4. On `/claim` the buyer sets a password and names the restaurant. That creates the owner, the business and restaurant, and an **active** Paddle subscription with no trial. If the email already has an account, they sign in and the plan is added to it.
5. Paddle events that arrive before set-up are acknowledged; set-up reads the subscription's current state from Paddle. A purchase cancelled before set-up can't be claimed.

**Monitoring:**
- Alert key `billing_guest_purchase_unlinked`: a paid purchase with an unknown intent or price.
- Alert key `billing_duplicate_purchase`: a second payment on one intent.
- Paid but unclaimed purchases are `CheckoutIntent` documents with `status: "paid"`.

Agency plans are not sold on this page yet.

## 1. External blockers (Paddle account owner)

Paddle will not take live payments until onboarding is approved. Only the account owner can do
these, in the **Paddle Live dashboard** (vendors.paddle.com):

1. **Account setup** — business details. GarnishTable is not a registered company: register as an
   individual/sole trader as Paddle's form allows. Do not enter a company name or registration that
   doesn't exist. Set the public business/display name to **GarnishTable** and the website to
   `https://garnishtable.com`.
2. **Domain review** — Paddle reviews `garnishtable.com`. It checks the live site for pricing,
   terms, privacy and refund policies and a contact method. The marketing legal pages currently build
   as "being finalized" until the legal facts are supplied (`GT_LEGAL_*` variables,
   `production-launch-checklist.md`) — expect review to wait on that.
3. **Identity verification** — the account holder's own ID, through Paddle's flow only. Never upload
   ID documents anywhere else or share them in chat.
4. **Final review** — Paddle's decision; payouts need a payout method on the account.
5. **Statement descriptor** — change it to `GARNISHTABLE` (shown on statements as
   `PADDLE.NET* GARNISHTABLE`).

Seller disclosure: Paddle is the merchant of record — checkout, receipts and invoices are issued by
Paddle on behalf of the seller's public business name. Whether any of Paddle's legally required
disclosures show the account holder's legal name for an individual seller is Paddle's decision and
could not be verified through the API; check a live receipt preview once onboarding is approved.

## 2. Catalog and plan mapping

The Live catalog must mirror the sandbox one exactly (sandbox and live are separate data spaces;
sandbox ids never work in Live). Prices are USD, tax category `saas`, tax mode follows the account
(`location`), and carry **no Paddle trial** — the 14-day trial is GarnishTable's own, card-free,
local-only until checkout.

| Plan code (`Plan.code`) | Product name | Monthly | Annual (2 months free) |
| --- | --- | --- | --- |
| `owner_starter` | Owner — Starter | $59.00 (`5900`) | $590.00 (`59000`) |
| `owner_growth` | Owner — Growth | $99.00 (`9900`) | $990.00 (`99000`) |
| `agency_growth_v2` | Agency — Growth | $179.00 (`17900`) | $1,790.00 (`179000`) |

Sandbox ids (for reference; already verified): `owner_starter` `pro_01m1a141d0kwpwgmc7q6018ra7`
(`pri_01m1a16seg05ajrn3b98hgqmgm` / `pri_01m1a176s22pjw4yzwnesdsdb6`), `owner_growth`
`pro_01m1a179wn1vtbbx6a8m3xv1zc` (`pri_01m1a17adqw0v3b51esancnkvt` / `pri_01m1a17azc4n9ajweg1cma81a7`),
`agency_growth_v2` `pro_01m1a17bjf3gpsj7vpzq2j6nbn` (`pri_01m1a17c4131fa52dep61xt40y` /
`pri_01m1a17cn4j7qes4rhajnnv0ck`).

Two scripts, both dry runs unless `--apply`, both refusing `PADDLE_ENV=sandbox` unless
`--allow-sandbox`, neither printing the API key:

- `scripts/createPaddleCatalog.ts` — finds or creates the products/prices from the Plan catalog
  (matched by `custom_data.internalPlanCode`; reuses what exists, refuses duplicates or mismatches,
  never edits/archives anything) and writes a mapping file.
- `scripts/setPaddlePriceIds.ts` — re-checks every id against Paddle (exists in this environment,
  active, right product, amount, currency, 1-month/1-year cycle, no Paddle trial) and only then
  writes them to the Plan documents, all-or-nothing.

Until the ids are loaded, plans carry `mock_price_*` placeholders, and with `BILLING_PROVIDER=paddle`
checkout refuses them (503, "isn't available yet") before any Paddle call.

Rehearsed against the sandbox on 2026-10-24: `createPaddleCatalog` found all 3 products and 6 prices
(all reuse, all checks passed) and `setPaddlePriceIds` validated the resulting mapping (dry run).

## 3. Secrets and configuration

All in `/opt/garnishtable/config/api.env` on the production server (mode 600, outside git). Live and
sandbox values are never mixed: production boot refuses `PADDLE_ENV≠production`, a `pdl_sdbx_` API key
or a `test_` client token whenever `BILLING_PROVIDER=paddle`.

| Variable | Value | Where it comes from |
| --- | --- | --- |
| `BILLING_PROVIDER` | `paddle` | — |
| `PADDLE_ENV` | `production` | — |
| `PADDLE_API_KEY` | live server key (`pdl_live_…`) | Live dashboard → Developer tools → Authentication. Needs read/write for customers, subscriptions, transactions; products/prices write only while creating the catalog. **Rotate the key that was shared in chat on 2026-10-23 before use.** |
| `PADDLE_CLIENT_TOKEN` | live client-side token (`live_…`) | Same page → client-side tokens (public, but per environment). |
| `PADDLE_WEBHOOK_SECRET` | the destination's secret key | Shown when the notification destination is created (§4). |
| `BILLING_CHECKOUT_ENABLED` | `true` (`false` = rollback switch, §7) | — |
| `TRIAL_PERIOD_DAYS` | `14` (default) | — |

## 4. Webhook

- **Endpoint:** `https://api.garnishtable.com/api/v1/webhooks/billing/paddle` (POST, JSON).
- **Verification:** `Paddle-Signature: ts=…;h1=…`, HMAC-SHA256 of `ts:rawBody` with
  `PADDLE_WEBHOOK_SECRET`, constant-time compare, 5-second timestamp tolerance (Paddle's documented
  default). The raw body is captured before JSON parsing. Invalid → 400 and a warning log; never
  disabled.
- **Idempotency:** every event id is claimed once in `BillingWebhookEvent`; duplicates are no-ops;
  subscription events are ordered by `occurred_at` (older events change nothing); an event for a
  subscription not recorded yet gets a 503 for 15 minutes so Paddle retries; simulator events
  (`ntfsimevt_…`) are recorded and ignored.
- **Events** (names confirmed against the Live account's event-type catalog): `subscription.created`,
  `subscription.updated`, `subscription.activated`, `subscription.trialing`, `subscription.past_due`,
  `subscription.paused`, `subscription.resumed`, `subscription.canceled`, `transaction.completed`
  (renewal history), `adjustment.created`, `adjustment.updated` (refund/chargeback history). A failed
  renewal arrives as `subscription.past_due`; `transaction.payment_failed` isn't needed.
- **Create:** Live dashboard → Developer tools → Notifications → new destination: URL as above, type
  webhook, the eleven events, then copy its secret into `PADDLE_WEBHOOK_SECRET`.

## 5. Preflight (all must pass before switching)

1. Paddle onboarding **approved**, `garnishtable.com` approved, display name GarnishTable, statement
   descriptor GARNISHTABLE, default payment link (Checkout → Checkout settings) set to
   `https://garnishtable.com/checkout`. Paddle accepts only an approved domain, and the page must load Paddle.js: the checkout page does, and opens any Paddle payment link (`?_ptxn=`) by itself. Without a default payment link, Paddle's overlay fails with
   `transaction_default_checkout_url_not_set` (seen in sandbox, Phase 40.1). It must be on an approved
   domain in Live.
2. Production runs current `main` (the running `b6b0f3e` lacks the simulated-webhook guard, the
   placeholder-price guard and the checkout pause switch). CI green for that commit.
3. Backup taken (`infrastructure/production/scripts/backup.sh`) and `api.env` copied to
   `api.env.bak-<UTC timestamp>`.
4. Live catalog created and ids loaded (§6 steps 2–4), dry runs clean.
5. Webhook destination created with exactly the eleven events.

## 6. Activation — **[approval]** for each step

0. Deploy the launch branch (it adds the platform-admin plans, Lemon Squeezy code (left inactive), the release-readiness fixes, the placeholder-price guard and `BILLING_CHECKOUT_ENABLED`) with `BILLING_PROVIDER` unchanged. Then check `/health` shows the new commit and run the smoke test.

1. Put the live values in `api.env` (§3) with `BILLING_CHECKOUT_ENABLED=false` first.
2. Copy the committed mapping into the container: `docker compose -p garnishtable cp docs/paddle-live-prices.json api:/tmp/paddle-prices.json` (from the server's repo checkout of the deployed commit). Skip `createPaddleCatalog`: the Live catalog already exists (§0).
3. (no step)
4. `docker compose -p garnishtable exec api node dist/scripts/setPaddlePriceIds.js --file /tmp/paddle-prices.json`: dry run, expect 3 product and 6 price changes from `mock_price_*` and no problems. Then run it again with `--apply`.
5. Recreate the api container (`docker compose -p garnishtable up -d api`); expect boot to pass the
   Paddle production checks; `curl -X POST …/webhooks/billing/paddle -d '{}'` → "Invalid webhook
   signature" (proves Paddle is selected and signatures are enforced).
6. Run a webhook simulation to the destination from the Paddle dashboard. Simulator events are signed
   with the destination's secret, so expect HTTP 200 and a `BillingWebhookEvent` row recorded with
   `processingError: "Ignored: provider simulator event — not applied"` — proof the secret matches —
   and no change to any subscription. A 400 means the secret in `api.env` doesn't match.
7. Set `BILLING_CHECKOUT_ENABLED=true`, recreate the api container.
8. **Controlled live verification — creates a real charge [approval, exact amount]:** the founder
   subscribes to Owner — Starter monthly with their own card ($59.00 plus any tax by location).
   Expect: `subscription.created` delivered and 200; local Subscription `active` on `owner_starter`;
   a billing-history row; entitlements applied. Then refund it in the Paddle dashboard (adjustment)
   and cancel — expect `adjustment.updated` (approved) → a refund history row, and the cancellation
   reflected. A 100%-off single-use discount code is an alternative that avoids moving money but still
   creates a real subscription — also needs approval.

## 7. Monitoring

- API logs: `billing webhook signature verification failed` (secret mismatch or forgery),
  `billing webhook event for a subscription not recorded yet` (transient), `paddle checkout refused
  — the plan's price id is not a Paddle price id` (catalog not loaded), `ignored invalid subscription
  status transition`.
- `BillingWebhookEvent` rows with `processingError` set; Paddle dashboard → Notifications → delivery
  logs (failed deliveries are retried; replay from there once fixed).
- Paddle metrics (active subscribers, MRR) vs. local active subscriptions, weekly.

## 8. Rollback

- **No real Paddle subscription exists yet:** restore `api.env.bak-<ts>` (back to
  `BILLING_PROVIDER=mock`), recreate the api container. Plans' Paddle ids can stay; mock ignores them.
- **Real Paddle subscriptions exist — never switch back to mock:** their webhooks would be rejected
  (renewals, failures and cancellations would stop being applied) and in-app cancellations would
  never reach Paddle, so customers could keep being charged. Instead:
  1. Stop selling: `BILLING_CHECKOUT_ENABLED=false`, recreate the api container. Webhooks, renewals,
     cancellations, plan changes and payment-method updates keep working.
  2. For an application bug: roll the application back (`infrastructure/production/scripts/rollback.sh`)
     keeping the Paddle configuration; Paddle retries undelivered webhooks, and missed ones can be
     replayed from the dashboard (retained 90 days).
  3. Individual customers: cancel or refund in the Paddle dashboard **[approval]** — the webhooks
     update GarnishTable.
  4. Leaving Paddle entirely means cancelling every live subscription in Paddle first, then switching.

## 9. Needs the founder

- Complete Paddle onboarding (§1) and the legal facts the domain review depends on.
- Rotate the Live API key shared in chat; create the new key, client-side token and webhook
  destination; put the values into `api.env` yourself (never in chat).
- Approve: the production deploy of current `main`; each activation step (§6); the controlled live
  transaction and its exact amount; any refund or cancellation of a live subscription.
