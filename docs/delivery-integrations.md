# Delivery Integrations (Phase 40)

This documents the real courier-dispatch system added this phase, in the same spirit as
`docs/pos-architecture.md` and `docs/payment-provider-decision.md`. It extends, and does not
replace, `docs/delivery-architecture.md` (Phases 9-10) — the Haversine eligibility/fee engine
(`services/delivery.service.ts`, the `POST /restaurants/:id/delivery/check` endpoint, and
`Order.deliveryFee`/`deliveryDistanceKm`/`deliveryAddress`) is **unchanged** and still the only
thing that answers "can we deliver here, for how much." This phase answers a different question:
once a delivery order exists, **who actually picks it up and brings it to the customer, and how is
that tracked.**

## What existed before this phase — and what didn't

Before this phase, "delivery" in this codebase meant exactly one thing: a customer-facing
eligibility/fee check at checkout time. There was no concept of a courier, no dispatch, no tracking,
no driver, no delivery-specific status beyond the generic `Order.status` enum's `out_for_delivery`
value (which nothing ever actually set programmatically — it was reachable but never driven by
anything real). `docs/delivery-architecture.md` said so explicitly: "Driver accounts, dispatch, live
GPS tracking, route optimization... explicitly out of scope." This phase is that scope.

## Architecture: Order → Delivery Service → Provider Adapter → External Provider

```
Order (unchanged)
  │  orderType:"delivery", deliveryAddress, deliveryFee — all Phase 9/10, untouched
  │
  ├─ Delivery (NEW — models/Delivery.ts)
  │    one document per dispatch ATTEMPT for an order, a separate collection (mirrors Payment.ts's
  │    precedent exactly): status, statusHistory, provider, fee (what the COURIER charges the
  │    RESTAURANT — different number from Order.deliveryFee, the CUSTOMER-facing charge),
  │    providerDeliveryId, trackingUrl, courierName/Phone, idempotencyKey
  │
  ├─ deliveryDispatch.service.ts — orchestration (createDeliveryForOrder / updateDeliveryStatus /
  │    cancelDelivery / retryDeliveryCreation) — the ONLY code that touches both a Delivery and the
  │    linked Order's status. Never provider-specific.
  │
  └─ DeliveryProvider interface (deliveryProviders/DeliveryProvider.ts) — one contract:
       healthCheck, getQuote, createDelivery, getDelivery, cancelDelivery,
       verifyWebhookSignature. Implemented by:
       ├─ ManualDispatchProvider — the restaurant's own fleet/rider. Zero config, zero network
       │    calls, always available. A first-class provider, not a placeholder.
       └─ UberDirectProvider — the first real third-party courier, BYOC-only (see below).
```

Nothing outside `deliveryProviders/` ever sees a provider-specific field name, status string, or
API shape. `order.controller.ts`, `pos.controller.ts`, the storefront checkout, and every admin/POS
UI component talk only to `Delivery` (the normalized model) and `deliveryDispatch.service.ts`.

## The normalized Delivery status lifecycle

`pending → quoted → requested → accepted → driver_assigned → picked_up → out_for_delivery →
delivered`, with `cancelled`/`failed` reachable from most non-terminal states. External provider
statuses are always mapped into this set (see `UberDirectProvider.ts`'s `mapUberStatus` — fails
closed to a non-terminal state for anything unrecognized, the same convention this codebase's
payment providers already use for `mapSafepayStatus`/`mapPaddleStatus`). Not every provider reports
every step — the transition table (`deliveryDispatch.service.ts`'s `DELIVERY_TRANSITIONS`) allows
several to be skipped (e.g. `accepted → picked_up` directly), but never allows the status to move
backward: a stale/out-of-order webhook event is logged and ignored, never applied.

**This lifecycle drives `Order.status` at exactly two points, not replaces it:**
- Delivery reaches `picked_up` or `out_for_delivery` → Order advances `ready → out_for_delivery`
  (only if the order was still `ready`; a no-op if a staff action already moved it there or beyond).
- Delivery reaches `delivered` → Order advances to `completed`.

Both transitions go through the exact same `applyOrderStatusTransition` (see below) a staff member's
manual status change uses — there is no second, parallel way an order's status can change.

## Idempotency and safety

- **Delivery creation**: `createDeliveryForOrder(orderId, restaurantId)` is idempotent — a stable
  key (`delivery_create_<orderId>`) and `Delivery`'s unique `{orderId}`/`{idempotencyKey}` indexes
  mean a duplicate call (a retried queue job, a double-click) always resolves to the same one
  Delivery document, verified under real concurrency (`deliveryDispatch.service.test.ts`'s
  "concurrent calls... race safely down to exactly one Delivery document").
- **Webhook idempotency**: `DeliveryWebhookEvent`'s unique `{provider, eventId}` index — processing
  always inserts this row FIRST; a duplicate-key error means "already handled," so a provider's
  documented at-least-once webhook redelivery can never re-apply a transition.
- **Provider failures never corrupt an order**: a failed courier-creation attempt lands the
  `Delivery` in `status:"failed"` with a human-readable `failureReason`/`lastProviderError` — the
  Order itself is untouched, and the restaurant sees a clear, retryable internal state (`POST
  .../delivery/retry`) rather than a silent gap or a corrupted order.
- **A cancelled/failed delivery never auto-cancels the Order** — a restaurant may re-dispatch via
  its own fleet after a third-party provider fails; that decision stays a human one.

## `applyOrderStatusTransition` — one order-status choke point

Extracted from `order.controller.ts`'s `updateOrderStatus` into
`services/orderTransition.service.ts` this phase, specifically so delivery-driven transitions reuse
the exact same transition validation, the online-payment guard, `statusHistory` recording, and
loyalty reversal that staff-driven changes already had — instead of a second, subtly-different copy
of that logic. `updateOrderStatus` itself is otherwise completely unchanged in behavior (verified:
all 70 pre-existing `order.controller.test.ts` tests still pass). This function is also where
delivery dispatch is actually triggered: when an order reaches `"ready"` and `orderType ===
"delivery"`, it enqueues `delivery.dispatch_create` on the **existing** `notifications` BullMQ queue
— non-blocking, so a courier-provider network call never sits inside the staff-facing status-update
response.

## Provider selection: why Uber Direct

Evaluated against this phase's own criteria (API availability, commercial accessibility,
geographic usefulness, lifecycle support, documentation quality, testability):

| Provider | Verdict |
|---|---|
| **Uber Direct** | **Selected.** A direct merchant-dispatch API (quote → create → track → cancel), not a marketplace/ordering integration. Documentation is public and detailed (`developer.uber.com/docs/deliveries`) with an official reference SDK (`github.com/uber/uber-direct-sdk`) to cross-check field names against. Available in multiple markets. |
| Careem Delivery APIs | Not selected this phase, but architecturally compatible — its documented shape (OAuth2, quote/create/track/cancel, webhook status events) is materially similar to Uber Direct's, so `DeliveryProvider` should generalize to it without redesign. Worth prioritizing next given this platform's Pakistan/regional strategy. |
| foodpanda Partner API | Not selected — closer to a marketplace/order-ingestion integration (foodpanda originates the order) than a dispatch-only API for orders this platform's own storefront already took. Different problem shape than this phase solves. |
| DoorDash Drive | Not selected — excellent reference architecture (informed `DeliveryProvider`'s own shape), but restricted to US/Canada/Australia/NZ, not useful for this platform's actual near-term markets. The abstraction is deliberately built so a `DoorDashDriveProvider` could be added later without touching anything outside `deliveryProviders/`. |
| Manual dispatch (own fleet) | **Selected, and shipped first.** Explicitly called essential in this phase's brief — a restaurant must never be forced to connect a third-party provider just to have delivery at all. Zero configuration, zero external dependency, always available; the reference implementation proving the `DeliveryProvider` contract holds even for a provider with no network calls whatsoever. |

## Uber Direct — capabilities, limitations, and honest verification status

`UberDirectProvider.ts`'s own header comment carries the full, itemized breakdown of what's
**VERIFIED** against Uber's real current documentation and official SDK source versus **reasonably
inferred but not independently confirmed against a live payload**. Summary:

- **Auth**: OAuth2 client-credentials grant (`POST https://auth.uber.com/oauth/v2/token`), token
  cached with an early-refresh margin.
- **Quote**: `POST .../delivery_quotes`. Uber's own docs note *"Access to this API may require
  written approval from Uber"* — a real commercial gate, not a technical one this adapter can bypass.
- **Create/track/cancel**: `POST .../deliveries`, `GET .../deliveries/{id}`, `POST
  .../deliveries/{id}/cancel`.
- **Webhooks**: header `x-uber-signature`, lowercase-hex HMAC-SHA256 of the raw request body, event
  envelope `kind:"event.delivery_status"` carrying `delivery_id`/`status`/a `data` object.
- **Not independently verified**: the exact field-by-field shape of a live `pickup_address`/
  `dropoff_address` JSON-encoded structure, and the precise shape of `data.courier` inside a real
  webhook payload — both implemented per Uber's documented convention, never invented, but never
  exercised against real traffic (no Uber Direct credentials were available while building this).

**Credentials are BYOC-only, per restaurant/location** — there is no platform-pooled Uber Direct
account the way Stripe/Safepay have for payments, because Uber Direct's real commercial model
requires each business to hold its own approved merchant relationship with Uber. A restaurant
connects via `POST /restaurants/:id/delivery-account` (client ID, client secret, customer ID,
webhook signing secret — all AES-256-GCM encrypted at rest, exactly like `RestaurantPaymentAccount`)
and points their own Uber Direct dashboard's webhook config at the URL that endpoint returns
(`/webhooks/deliveries/uber_direct/:accountId`).

If a restaurant sets `settings.deliveryProvider:"uber_direct"` but has no currently-active connected
account (never connected, disconnected, or invalid), dispatch **falls back to manual** rather than
blocking delivery entirely — logged, never silent — so a misconfigured third-party provider can
never be the reason an order can't be fulfilled at all.

## Testing method — what was actually verified, and how

No live Uber Direct credentials exist for this deployment (per Uber's own docs, quote-API access
"may require written approval"). Verification therefore has three honest tiers, and this phase never
mixes them:

- **IMPLEMENTED**: the full `DeliveryProvider` contract, the orchestration service, webhook
  handling, RBAC/tenant isolation, and the admin UI all exist and run.
- **MOCK/MANUAL VERIFIED** (automated tests, real code paths, no real Uber Direct network calls):
  - `deliveryDispatch.service.test.ts` (14 tests) — creation idempotency (including real concurrent
    races), the full status lifecycle against the `ManualDispatchProvider` (a REAL provider
    implementation, not a test double — no network calls needed since manual dispatch has none by
    design), Order-mirroring correctness, invalid/stale-transition rejection, cancel/retry guards,
    multi-tenant isolation.
  - `deliveryWebhook.controller.test.ts` (10 tests) — a real `RestaurantDeliveryProviderAccount` is
    created with a known webhook signing secret; test payloads are signed with the exact same
    HMAC-SHA256 algorithm `UberDirectProvider.verifyWebhookSignature` implements (not a mocked
    verifier) and POSTed through the real Express route. Covers valid/missing/tampered/wrong-secret
    signatures, idempotent duplicate delivery, cross-tenant isolation, out-of-order/stale status
    rejection, and Order-mirroring via the webhook path specifically.
  - `restaurantDeliveryProviderAccount.controller.test.ts` (9 tests) — connect/disconnect/reconnect
    flow with `Uber Direct`'s OAuth token endpoint mocked at the `fetch` layer (same technique this
    codebase's existing Safepay/Stripe Connect tests already use), plus the agency-exclusion RBAC
    test below.
- **NOT SANDBOX/LIVE VERIFIED**: no request has ever been made against Uber's real API (sandbox or
  production) with this adapter. This is stated plainly, not implied — the same honesty convention
  `docs/payment-provider-decision.md` already established for Stripe/Safepay.

## RBAC and multi-tenant/agency isolation

- **`restaurant.orders.manage`** (existing, staff-level) gates the per-order dispatch endpoints
  (manual-status/cancel/retry/get) — the same permission every other staff order action already
  uses. Reused by agency roles that manage a business's day-to-day orders, same as before.
- **`restaurant.payments.manage`** (existing, owner/manager-level, deliberately excluded from every
  agency role) gates the delivery-PROVIDER-ACCOUNT connect/disconnect endpoints. This was a
  deliberate choice, not the more obvious `restaurant.settings.manage`: a connected Uber Direct
  account is the same class of sensitive third-party credential as a payment account, and
  `restaurant.payments.manage` is the one existing permission that already keeps that exact class of
  credential owner-only, never agency-manageable (see `agencyRbac.ts`'s own doc comment: "restaurant
  payment-provider credentials stay owner-only"). Verified by a dedicated test: an `agency_owner`
  membership on the business is confirmed **forbidden** from the delivery-account endpoints, the same
  as it already is for payment accounts.
- Zero new permissions were added.

## Notification/queue reuse (no new infrastructure)

- **Queue**: `delivery.dispatch_create` is a new job NAME on the **existing** `notifications` BullMQ
  queue (`queues/notification.queue.ts`), sharing its existing Redis connection. No second queue
  system was introduced.
- **Notifications**: delivery-driven Order transitions (`out_for_delivery`, `completed`) emit
  through the **existing** `emitOrderEvent`/`orderEventBus` — the same Socket.IO live-dashboard push
  and BullMQ-logged job every other order status change already triggers (see
  `events/orderEventListeners.ts`). No parallel notification path was built.

## Restaurant setup (owner-facing)

1. Enable delivery under Settings → Delivery (unchanged from Phase 9/10) and set coordinates/radius.
2. Under the same page's new "Courier / dispatch" section: keep **"Your own delivery"** (default,
   zero setup — staff dispatch/track manually from each order's detail view) or select **"Uber
   Direct"** and connect an account (client ID/secret, customer ID, webhook signing secret — from
   the restaurant's own Uber Direct merchant dashboard), then paste the shown webhook URL back into
   that same Uber dashboard.
3. Nothing else changes about checkout, payments, or the storefront.

## Production requirements before this is a live third-party integration

1. A real, approved Uber Direct merchant account and credentials to test the full quote → create →
   track → cancel → webhook loop against Uber's actual sandbox, then production.
2. Independent confirmation of the two "reasonably inferred, not verified" details above (address
   JSON structure, webhook `data.courier` shape) against a real payload.
3. A production monitoring hook for `Delivery.status:"failed"` (currently visible only via the
   admin/POS UI's status panel and structured logs) — e.g. a dashboard alert or digest, so a stuck
   failed delivery is never only discoverable by a staff member happening to open that order.
4. A live Careem Delivery APIs adapter, given this platform's stated regional priorities — the
   `DeliveryProvider` contract this phase built was deliberately shaped to make that a second adapter
   file, not a redesign.
