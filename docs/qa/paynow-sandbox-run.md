# Pay-now checkout — Paddle sandbox run (21 Nov 2026)

Branch `feat/paddle-live-launch`. Local stack:
- the API in `BILLING_PROVIDER=paddle` with `PADDLE_ENV=sandbox`, on a separate database (`restaurant_platform_paynow`);
- the marketing site on :5175 and the admin app on :5174;
- Chrome.

The sandbox catalog was loaded with `setPaddlePriceIds --allow-sandbox`. The dry run checked all 3 products and 6 prices against Paddle before anything was written; this is the same procedure as for Live.

**Webhook delivery.** Paddle can't reach localhost, and the sandbox destination still points at an expired tunnel. It was left unchanged: no Paddle settings were changed in this run. Instead, a relay read Paddle's own recorded notifications for that destination (`GET /notifications`) and posted them to the local API. Each was signed exactly as Paddle signs, with the destination's real secret. The payloads are Paddle's own, unaltered; only the HTTP delivery was local.

## Results

| # | Scenario | Result |
|---|---|---|
| 1 | Pricing page shows "Pay now — no trial" on Owner Starter and Growth only (not on the agency plan) | Pass |
| 2 | `/checkout`: plans cheapest first, Starter preselected from `?plan=` | Pass (ordering fixed during the run) |
| 3 | Real Paddle sandbox overlay: Test Mode, Owner — Starter, US$59.00/month, no trial. Paid with the test card 4242… | Pass |
| 4 | `subscription.created` (signed) → intent **paid**, plan resolved from the price, set-up email produced (`/claim#token=…`) | Pass |
| 5 | `subscription.activated` and `transaction.completed` before set-up → acknowledged (200) | Pass |
| 6 | Checkout page shows "Payment confirmed" only after the webhook; the page then starts from the top | Pass (scroll fixed during the run) |
| 7 | `/claim` (new account): the paid plan is shown, the email is fixed to the checkout email, the token is removed from the address bar | Pass |
| 8 | Account set-up creates the owner, business and restaurant, signs them in, and lands on the dashboard | Pass |
| 9 | Billing page: Owner — Starter **Active**, US$59.00/mo, renews 22/12/2026, history "Payment succeeded US$59.00" | Pass |
| 10 | Database: one active Paddle subscription, no trial, matches Paddle; all 3 webhook events processed without error | Pass |
| 11 | Paddle: the subscription is active at quantity 1; the customer is tagged with the new business | Pass |
| 12 | Existing customer: a trial owner (14-day local trial) pays with the same email → `/claim` says the email has an account → sign in → returns to `/claim` → "Add plan to my account" | Pass |
| 13 | The trial is converted in place (one subscription; trial end cleared; history trial → created → paid) | Pass |
| 14 | Paddle delivered `subscription.activated` before `subscription.created` (twice) → 503, retried → 200 after `created` | Pass |
| 15 | Checkout closed without paying → back to the plans; a reload doesn't show "Confirming" | Pass |
| 16 | Quantity raised to 2 in Paddle's checkout (US$118.00) → access granted, `billing_quantity_above_one` alert raised | Pass (alert added during the run) |

## Found and fixed during the run

- **Quantity above 1.** Paddle's checkout lets the buyer change the quantity, so they can pay $118 for one account. Prevent it with a quantity cap on the Paddle prices (minimum 1, maximum 1), in both sandbox and Live. That is a catalog change, so it needs approval. The server now flags any checkout or pay-now purchase with quantity above 1 (`billing_quantity_above_one`), so the extra can be refunded.
- **Plan order:** the checkout page listed Growth before Starter. It now lists them cheapest first.
- **Scroll position:** the confirmation kept the plan list's scroll position, so its heading was cut off. It now starts at the top.

## Noted, not changed

- **503 error code.** The "subscription not recorded yet" 503 is answered with error code `INTERNAL_ERROR`. This is existing behaviour: the retry works, but the code name is misleading in logs.
- **Seller name.** Paddle's checkout footer names the seller as the account holder's legal name, because the display name is unset. Only Paddle support can set it.
