# Paddle sandbox test plan (Phase 89 billing fixes)

Prepared 2026-10-13 for the live-billing migration. Nothing in this plan has been executed against
Paddle yet; each case records its result only when it is actually run.

## Why this plan exists

Production runs commit `b6b0f3e` with `BILLING_PROVIDER=mock`. Its billing code passes 169 automated
tests (10 suites, re-run locally 2026-10-13: 169/169), but those tests simulate Paddle's responses.
The real-sandbox evidence (Phase 40–40.3, 2026-08-31 to 09-01, `docs/commercial-decisions.md`
§20–22) covers the older code only, and its webhooks were signed locally and posted straight to the
app — Paddle never delivered one over the internet.

Never exercised against a real Paddle sandbox:

| Change (Phase 89) | What it does |
|---|---|
| P1 — plan change | Sends the new plan's price for the subscription's own interval via `PATCH /subscriptions/{id}`; refuses a plan with no price for that interval |
| P2 — transaction/adjustment events | Never change subscription status (a successful payment can no longer mark it past due) |
| P3 — period refresh and event order | Renewals move `currentPeriodStart/End`; events ordered by `occurred_at`; a plan changed in Paddle's dashboard is reflected locally; "active + scheduled cancel" maps to `cancelling` |
| Refunds and chargebacks | Approved refunds, chargebacks and reversals recorded once in billing history (`noticeKey`); renewal payments add a "payment succeeded" row |
| P4 — price-ID script | `setPaddlePriceIds.js` validates each id against Paddle before writing |
| P5 — key check | Production refuses sandbox keys (config only; covered by unit tests) |
| Real webhook delivery | Paddle → public URL → signature check (5-second replay window) → idempotent processing |

## Guardrails

- Sandbox only: `PADDLE_ENV=sandbox`, a `pdl_sdbx_` key, `sandbox-api.paddle.com`. Never the live
  API, never production's database, never `api.garnishtable.com`.
- Test cards only (Paddle sandbox rejects real cards). No real money moves.
- The existing sandbox catalog (3 GarnishTable products, 6 prices) is read, never edited. The
  leftover "Phase 34 Verification Product" is left alone and must never be copied to live.
- Every sandbox entity this plan creates is listed in the run log (below) so it can be cleaned up.
- Each step that creates something in Paddle (destination, customers, checkouts, simulations) needs
  the operator's go-ahead at the time it runs.

## Setup (once)

| # | Item | Status 2026-10-13 | Who |
|---|---|---|---|
| S1 | Paddle MCP plugin (`paddle@claude-community`) | Installed (user scope) | done |
| S2 | `paddle-sandbox` MCP key, preferably a read-only key for audits, stored in the OS keychain via `/plugin configure paddle@claude-community` | Not set | founder (dashboard + prompt) |
| S3 | `paddle-live` MCP via OAuth (`claude mcp login plugin:paddle:paddle-live` in an interactive terminal), read-only | Connected; verified 2026-10-13 by read-only calls (live webhook IPs match Paddle's published live list; catalog, discounts and destinations empty; seller onboarding pending) | done |
| S4 | Local API sandbox settings in `apps/api/.env` (never committed): `BILLING_PROVIDER=paddle`, `PADDLE_ENV=sandbox`, `PADDLE_API_KEY` (present, sandbox format), `PADDLE_CLIENT_TOKEN` (sandbox `test_…` token — added 2026-10-13 via a hidden-input prompt; validated locally: one line, `test_` format, API config loads, admin's sandbox/token rule accepts it for sandbox and rejects it for production), `PADDLE_WEBHOOK_SECRET` (empty — comes from S6); `BILLING_PROVIDER` is still `mock` locally and is switched only for the test run | Partly | S6 secret outstanding |
| S5 | Public tunnel to the local API: a temporary `cloudflared` quick tunnel (no account, no service) | Installed 2026-10-13: `cloudflared` 2026.9.3 standalone exe at `%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe` (user folder, no admin); SHA256 matches Cloudflare's release notes and GitHub's digest; Authenticode signature valid (Cloudflare, Inc.). Tunnel not started | start only for a test session |
| S6 | New **sandbox** notification destination → `<tunnel>/api/v1/webhooks/billing/paddle`, subscribed to `subscription.*`, `transaction.completed`, `transaction.payment_failed`, `adjustment.created`, `adjustment.updated`; its secret into `PADDLE_WEBHOOK_SECRET` | Sandbox has 0 destinations today | creates a sandbox entity — approval at run time |
| S7 | Local dev plans mapped to the sandbox price ids (P4 script, dry run then `--apply` against the **local** database) | Applied 2026-10-13 to `localhost:27017/restaurant_platform` after a passing dry run; a second dry run reports "no changes". Local plans now carry sandbox ids instead of `mock_price_*` | done |
| S8 | Local worker on Redis ≥ 5 (Redis 8 on port 6380), `EMAIL_PROVIDER=console` so emails are logged, not sent | Redis 8.10.1 running on 127.0.0.1:6380 for the session | done (per session) |
| S9 | Webhook-only relay (`127.0.0.1:4100` → only `POST /api/v1/webhooks/billing/paddle` on `127.0.0.1:4000`), so the tunnel never exposes the rest of the local API | Written and running for the session | done (per session) |

2026-10-13 blocker: from inside Claude Code's shell, `cloudflared` fails every quick-tunnel request
with `Post "https://api.trycloudflare.com/tunnel": context deadline exceeded` (4 attempts: default,
`--protocol http2`, `--edge-ip-version 4`, PowerShell), while `curl` from the same machine registers in
~5 s over IPv4. Next: run the tunnel from the founder's own terminal.

## Test cases

Method: **C** = real sandbox checkout in the admin UI; **S** = Paddle webhook simulator (signed with
the destination's secret, delivered over the internet); **A** = Paddle sandbox API call; **L** = local
app action. Every case checks Paddle's side and the local `Subscription`, `BillingWebhookEvent` and
`BillingHistoryEvent` records.

| ID | Behaviour | Method | Steps | Pass when |
|---|---|---|---|---|
| T1 | Checkout → subscription (owner) | C | Owner Starter monthly, card `4242 4242 4242 4242` | Paddle subscription `active`; `subscription.created` delivered through the tunnel and verified; local subscription active with the right plan, interval, period dates and entitlements; one `BillingWebhookEvent` per event id |
| T2 | Checkout → subscription (agency) | C | Agency Growth monthly | Same as T1 for the agency owner |
| T3 | Declined checkout | C | Card `4000 0000 0000 0002` | Checkout shows the error; no local subscription change; no subscription in Paddle |
| T4 | Customer reuse | C | Second checkout attempt for the same owner | Same Paddle customer id (no duplicate customer) |
| T5 | Upgrade (P1) | L | T1 owner: Starter → Growth monthly in the app | `PATCH /subscriptions/{id}` sent with Growth **monthly** price id; Paddle shows the new item; `subscription.updated` brings the local plan to Growth; entitlements change |
| T6 | Downgrade (P1) | L | Growth → Starter | Mirror of T5 |
| T7 | Interval guard (P1) | L | Change a yearly subscription to a plan without a yearly price (test plan in the local DB only) | Refused before any Paddle call; nothing changes in Paddle |
| T8 | Plan changed in Paddle's dashboard (P3) | A | Change the item on the T2 subscription in sandbox | Local plan follows; `lastProviderEventAt` advances |
| T9 | Renewal and period refresh (P3) | S | Scenario `subscription_renewed` on the T1 subscription | `currentPeriodStart/End` move forward; one "payment succeeded" history row; status stays `active` (P2: the transaction events don't touch status) |
| T10 | Duplicate delivery (idempotency) | S | Replay the same event (simulator "resend") | Still one `BillingWebhookEvent`; no second history row |
| T11 | Out-of-order delivery (P3) | S | Send an older `subscription.updated` after a newer one | Nothing rolls back; local state unchanged |
| T12 | Scheduled cancellation (P3) | L then S | Cancel at period end in the app; let Paddle send `subscription.updated` with `scheduled_change` | Local status `cancelling` with the right `cancelAt` — **not** reactivated (the Phase 89 bug) |
| T13 | Reactivate | L | Remove the scheduled cancellation in the app | Paddle `scheduled_change` cleared; local `active` |
| T14 | Immediate cancellation | S | Scenario `subscription_canceled` | Local `cancelled`; entitlements removed at the right time |
| T15 | Failed renewal → past due | C then S | Subscribe with card `4000 0027 6000 3184` (first payment succeeds, renewals decline); run a renewal | `transaction.payment_failed` recorded without changing status (P2); `subscription.updated` with `past_due` → local `past_due`; the in-app notice shows |
| T16 | Recovery from past due | A/S | Update the payment method to `4242…` and retry | Local back to `active` |
| T17 | Refund (adjustment) | A | Create a full refund adjustment on a T1 transaction (sandbox auto-approves within ~10 minutes) | `adjustment.created` then `adjustment.updated` (approved) → exactly one negative refund row on the billing page |
| T18 | Chargeback and reversal | S | Single events `adjustment.created`/`updated` with action `chargeback`, then `chargeback_reverse` | One row each; repeats recorded once |
| T19 | Signature failures | L | Post a body with a wrong secret, a tampered body, and a stale timestamp (> 5 s) to the tunnel URL | All rejected with 400; nothing stored |
| T20 | Real delivery timing | S | Watch accepted deliveries in T1–T18 | No valid delivery rejected by the 5-second replay window (if any are, record the skew before changing anything) |
| T21 | Trial reminder | L | Local owner trial ending within the reminder window; run the daily `billing.trial_reminder_tick` | One reminder email logged; `trialEndingReminderSentAt` set; a second tick sends nothing |
| T22 | Trial expiry | L | Trial past its end with no paid subscription; run `billing.trial_expiration_tick` | Local subscription ends; paid features locked; no Paddle call |
| T23 | Price-ID script (P4) | A | `setPaddlePriceIds.js --file <sandbox mapping>` dry run with `--allow-sandbox`, then one deliberately wrong amount | Dry run reports all six ids valid; the wrong one is refused; nothing written without `--apply` |

Not testable in sandbox: Paddle Retain (live accounts only), payouts, manual approval of high-value
refunds, and anything involving real cards.

## Run log

Record for every case: date/time, operator, Paddle ids created (customer, subscription, transaction,
adjustment, simulation), webhook event ids, observed local state, and PASS/FAIL with evidence.
Nothing is marked PASS without that evidence.

| ID | Date | Result | Evidence |
|---|---|---|---|
| T23a | 2026-10-13 00:40 UTC | PASS (real sandbox, read-only) | `setPaddlePriceIds.ts --file <sandbox mapping> --allow-sandbox`, dry run: `Paddle environment: sandbox`; 3 products and 6 prices checked; "all checks passed — dry run, nothing written"; exit 0. Local dev plans still hold `mock_price_*` (S7 not applied). |
| T23b | 2026-10-13 00:41 UTC | PASS (real sandbox, read-only) | Same script with owner_starter monthly mapped to the $15 verification price: refused with "price belongs to product pro_01m15cqh…, not pro_01m1a141…" and "Paddle charges 1500 but the plan says 5900"; "nothing was written"; exit 1. (A first attempt reusing a Growth price was refused earlier by the duplicate-id check.) |

| Delivery check (T19/T20 groundwork) | 2026-10-13 18:26 UTC | PASS (real sandbox) | Destination `ntfset_01m4sdxe6t33frjhpqx72186j1` (URL updated to the new tunnel; same id, same 11 events; returned secret matches local). Simulation `ntfsim_01m4se0za2mf5mprvd10awzfpf` run `ntfsimrun_01m4v891jprzm31x34xkpb4nev`: Paddle status `success`, response `200 {"received":true}`; relay `POST … (5520 bytes, signed=true) -> 200`; API: signature accepted, "billing webhook event for unknown subscription reference" (simulator sample id), `statusCode 200`; local `billingwebhookevents`: one row `eventId ntfsimevt_01m4v891k315ma6xe6dhfxfmv9`, `subscription.updated`, `processedAt` set. Earlier run (01:19 UTC) was rejected with 400 because the local clock was 555 s slow — fixed by syncing Windows time (now within ±0.03 s). Unsigned/wrong-signature posts through the tunnel → 400; non-webhook paths → 404 at the relay. |

| T1 | 2026-10-13 19:21–19:23 UTC | PASS (real sandbox checkout) | Owner Starter monthly no-card trial → "Add payment method" (Phase 89 fix) → Paddle.js overlay, card 4242…: customer `ctm_01m4vbdp…`; transaction `txn_01m4vbdr…` completed, origin web, 5900 USD; subscription `sub_01m4vbfs…` active on `pri_01m1a16seg05ajrn3b98hgqmgm` (5900 USD / 1 month), period 10-13 → 11-13, custom_data ownerType=business, planCode=owner_starter, billingInterval=monthly. Paddle: 3 notifications delivered on attempt 1. Relay: 3 signed deliveries → 200. Local: one `billingwebhookevents` row each for `subscription.created`, `subscription.activated`, `transaction.completed`; subscription now `provider=paddle`, `active`, owner_starter/monthly, provider ids set, period matches Paddle; billing history `subscription_created` 5900 + `payment_succeeded` 5900. Note: `subscription.activated` was processed while `subscription.created` was still in flight and was recorded as "unknown subscription reference" (no state lost this time — `created` carried `active`). |
| T10 (duplicates) | 2026-10-13 19:24 UTC | PASS (real sandbox) | Paddle replays of `subscription.created` (`ntf_01m4vbjjv…`) and `transaction.completed` (`ntf_01m4vbjkr…`), same event ids: both delivered, relay → 200; still 3 webhook-event rows, 2 history rows, 1 live subscription, subscription `updatedAt` unchanged; no API errors. |
| T7 (interval guard) | 2026-10-17 | **Covered by automated test only — not a manual end-to-end PASS** | Manual sandbox run skipped by founder decision: the billing page lists every active, publicly listed `OWNER` plan to all owners (`GET /plans`), so a temporary unpriced plan could not be isolated from the other local owner accounts. No plan was inserted, nothing changed in Paddle or the database. Coverage: `apps/api/src/services/billingLifecycle.service.test.ts` "refuses a plan with no provider price for that interval, without calling the provider" (lines 93–99) — a monthly subscription changed to a plan whose monthly price has no `providerPriceId` rejects with "no monthly price configured", a spy on the configured provider's `changePlan` is never called, and the subscription's plan is unchanged. Not covered: the yearly case named in this plan (the same `resolvePricing(plan, subscription.billingInterval)` guard, exercised only with monthly), the HTTP 400 at the route, and the admin UI's handling of the error. |

Simulated (no Paddle traffic), 2026-10-13: 12 API suites — 10 Paddle suites plus
`subscription.service` and `notification.queue` (trial reminder/expiry) — 188/188 pass; admin
`paddleEnvironment` and `billingHistoryDisplay` — 10/10 pass.

## Cleanup after the run

- Cancel every test subscription created by this plan (sandbox).
- Deactivate the test notification destination (S6) once testing ends, or keep it pointed at a
  dedicated test endpoint — never at production.
- Remove `PADDLE_CLIENT_TOKEN`/`PADDLE_WEBHOOK_SECRET` from `apps/api/.env` if the sandbox setup is
  no longer needed; set `BILLING_PROVIDER` back to mock locally.
- Leave the sandbox catalog unchanged.

## Fixes found by T1 (local, uncommitted)

| Fix | Change | Automated tests (2026-10-13) | Real sandbox |
|---|---|---|---|
| T1 checkout wiring | Billing page: trialing owner without a provider subscription gets an early-checkout button; checkout always uses the trial's own plan and interval (the picker default was `owner_growth`, so a Starter trial would have been charged for Growth); `createCheckoutSessionCore` refuses (409, before any provider call) a checkout whose plan or interval differs from the local trial | admin `trialCheckout.test.ts`; API `billingCheckout.controller.test.ts` "converts on its own plan" — pass | Verified by T1 |
| A — immediate billing is stated | Early-checkout button reads "Subscribe now — {price} charged today" (price from the trial plan and interval) with "Ends your free trial today; unused trial days aren't carried over"; the 3-day banner says subscribing ends the trial and charges today | admin `trialCheckout.test.ts` (wording, monthly/yearly, missing price) — pass | Pending (UI check) |
| B — out-of-order delivery | An event for a not-yet-recorded subscription that would change something and is < 15 min old now throws 503 (claim released, Paddle retries) instead of being marked processed; older or no-op events are still recorded and ignored; mock events (no `occurred_at`) are unaffected | `billingLifecycle.service.test.ts` "out-of-order delivery" (3 tests) — pass | Pending (needs the local API restarted with this code and a new sandbox subscription) |
| C — stale trial date | Checkout completion and any transition to `active` clear `trialEnd` | `billingLifecycle.service.test.ts` checkout-completion test + the race test's assertion — pass | Pending |
| D — trial start shown as a $59 charge | Found 2026-10-13 on the Fix A UI check: a no-card trial's history row was `subscription_created` with `amountCents: 5900` and showed "Subscription started … $59.00" although nothing was charged. Now: `createSubscriptionCore` records a new `trial_started` type with no amount (metadata: plan, interval, trial end) — shown as "Free trial started"; and "trial started" / "subscription started" rows never display an amount (legacy rows included, stored data unchanged; payments, refunds, chargebacks and plan changes display as before). Note: the local API reads `@restaurant/types` from `packages/types/dist` — rebuilt locally; release images build it themselves | admin `billingHistoryDisplay.test.ts` (start rows show no amount, payments show the real amount) — pass; API `billingCheckout.controller.test.ts` "billing history for a no-card trial" (trial → `trial_started` without amount, via the DB and the history API; early checkout → `payment_succeeded` 5900 USD; active, `trialEnd` cleared; repeated completion refused, still 3 rows and 1 live subscription) — pass | Pending (needs the local API restarted to load the rebuilt types) |

## Findings to carry into the live migration

- `Paddle.Initialize` is called without `pwCustomer` (`apps/admin/src/lib/paddle.ts`). Paddle Retain
  needs it for logged-in customers ("To use Retain, pass `pwCustomer` for logged-in customers"; live
  only). Decide whether Retain is in scope; if so, pass the owner's `ctm_…` id.
- Paddle recommends removing `Paddle.Environment.set()` for live; the code calls
  `Environment.set("production")`, which Paddle documents as a valid value. Low priority.
- Prices carry no Paddle trial period — the 14-day trial is local, before checkout. Live prices must
  match (the P4 script already refuses ids with a Paddle trial).
