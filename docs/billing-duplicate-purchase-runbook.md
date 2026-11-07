# Billing: unlinked paid subscriptions

Two situations leave a customer paying the billing provider (Lemon Squeezy, or Paddle) for a
subscription that no GarnishTable account uses. Neither is fixed automatically: there is no tested
refund or cancel policy yet, and an automatic refund that misfires is worse than a delayed manual one.
Both are recorded and logged at `error` level with an `alert` key to page on.

| `alert` key | Log message starts with | What happened |
|---|---|---|
| `billing_duplicate_purchase` | `duplicate purchase — owner already has a live subscription` | An account that already has a live subscription completed a second checkout (two tabs, a double click, or a second purchase). The first subscription stays; the new one is **not linked**. |
| `billing_webhook_rejected` | `billing webhook event rejected — not applied` | A correctly signed provider event was refused. For Lemon Squeezy: a `subscription_created` whose checkout data wasn't signed by this server, was altered, or names a different variant than the one bought (e.g. a purchase through a public buy link, or edited `checkout[custom]` values). Nothing was attached to any account. |

## Where to look

- **Log line** fields: `provider`, `ownerType`/`ownerId` (duplicate only), `existingSubscriptionId`,
  `unlinkedProviderSubscriptionId` or `providerSubscriptionId`, `providerCustomerId`, `eventId`,
  `reason` (rejected only).
- **Database**: `billingwebhookevents` with that `eventId`. `processingError` starts with
  `Duplicate purchase:` or `Rejected:` and the stored `payload` holds the event (pre-signed billing
  links are removed before storage).
- **Provider dashboard**: the subscription id from the log (Lemon Squeezy → Subscriptions).

## What to do

1. **Confirm it's real money.** In the provider dashboard, check the subscription exists, is active
   and was charged (test-mode objects are labelled as such).
2. **Duplicate purchase:** contact the customer. Usually: refund the newest charge and cancel the
   unlinked subscription in the provider dashboard. If they meant to change plan, change the plan
   on their existing subscription from GarnishTable instead.
3. **Rejected purchase:** do not link it by editing the database. Find who paid (customer email in
   the provider dashboard). If they are a genuine GarnishTable owner, refund and cancel it and ask
   them to subscribe from **Billing** inside the app, so the checkout is signed for their account.
   If nobody recognises it, refund and cancel it.
4. Note the outcome against the `eventId` (support ticket or incident log).

A cancellation made in the provider dashboard sends `subscription_updated` /
`subscription_cancelled` / `subscription_expired` events for the unlinked subscription. They are
acknowledged and ignored as an unknown reference — no account is affected.

## Why there is no automatic refund

Refunding or cancelling from inside the webhook would need a tested policy for partial periods,
taxes the Merchant of Record already collected, and the case where the "duplicate" was the plan the
customer actually wanted. Until that exists, a person decides.
