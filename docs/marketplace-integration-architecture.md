# Marketplace integration architecture (Uber Eats / DoorDash / foodpanda)

Foundation for receiving orders directly from third-party marketplaces into GarnishTable's own
order system — not a second order pipeline, and not a claim that any provider is production-live.

## Status (be precise about this)

| Provider    | Architecture | Real network calls | Production access |
|-------------|:---:|:---:|:---:|
| Uber Eats   | Implemented, built against Uber's own current docs | Never exercised against a live account | Requires Uber's written approval |
| DoorDash    | Implemented, built against DoorDash's own current docs | Never exercised — sandbox itself requires a DoorDash TAM | Requires DoorDash certification |
| foodpanda   | Implemented, built against foodpanda's own current docs (menu-CREATE not confirmed, see FoodpandaProvider.ts) | Never exercised against a live account | Requires Partner API access |

`MARKETPLACE_PROVIDER_MODE=mock` (the default) makes every provider name resolve to
`MockMarketplaceProvider`, so the whole pipeline — webhook → idempotency claim → BullMQ job →
menu-mapping resolution → `createOrderForCustomer` → accept — is genuinely exercisable end-to-end in
dev/test with zero real credentials. `=live` requires the real per-provider env vars (see
`.env.example`) and will throw a clear, specific error the moment an unconfigured provider is
actually used — never a fabricated "connected" state.

## Why credentials are platform-level, not BYOC

Unlike `RestaurantPaymentAccount`/`RestaurantDeliveryProviderAccount` (a restaurant brings its own
separate provider credentials), all three marketplace providers authenticate GarnishTable itself as
one registered partner app for the whole deployment (Uber Eats' `client_credentials` grant,
DoorDash's TAM-issued signing key, foodpanda's `client_credentials` token valid across an entire
`chainID`). The per-restaurant piece is only an `externalStoreId`, stored on
`RestaurantMarketplaceIntegration`. See that model's own header comment for the full reasoning.

## Data flow

```
Marketplace webhook
  -> POST /webhooks/marketplace/:provider   (ONE centralized endpoint per provider, all restaurants)
  -> signature verification (platform-level secret)
  -> idempotency claim (MarketplaceWebhookEvent, same atomic-claim pattern as billing webhooks)
  -> 200 ack, IMMEDIATELY (Uber Eats: 11.5-minute accept/deny SLA from here)
  -> resolve RestaurantMarketplaceIntegration by {provider, externalStoreId}
  -> enqueue marketplace.order_ingest (BullMQ, elevated priority)
       -> fetch full order from provider
       -> map external item/modifier ids -> internal via MarketplaceMenuMapping
          (unmappable item -> denyOrder, never guess)
       -> resolve a synthetic customer (mirrors POS walk-in customers)
       -> createOrderForCustomer(channel:"marketplace", paymentMethod:"marketplace",
          markPaidImmediately:true)   <-- the SAME canonical order-creation path every order uses
       -> provider.acceptOrder
       -> mark MarketplaceWebhookEvent processed
  -> Order now flows through the exact same POS/Kitchen/Staff/reporting surface as any other order
```

No parallel order/kitchen state machine exists or is planned — see `orderCreation.service.ts`'s own
"one canonical order-creation path" doc comment.

## Payment interaction

A marketplace order gets **no `Payment` document** — the same precedent cash/staff-attested-card
orders already establish (`Payment.ts`'s own comment: "intentionally have no Payment documents...
this collection exists only for payments that actually go through a provider"). The diner paid the
marketplace directly; GarnishTable's own `PaymentProvider`/Stripe/Safepay machinery is never invoked
for these orders, and never could be — the money already changed hands entirely outside this
platform.

## orderType is always "pickup"

Regardless of what the marketplace itself calls the order (pickup or delivery), GarnishTable's own
`orderType` is always `"pickup"`: the kitchen's job is "prepare this, someone will collect it" — the
marketplace's own courier network (or the diner) handles the actual hand-off, never this platform's
own delivery-eligibility/fee engine, which would incorrectly reject an order outside this
restaurant's configured delivery radius even though GarnishTable never dispatches or is paid for
that leg.

## Security

- Credentials: platform-level secrets live only in env vars (never committed); the one field
  reserved for a future per-restaurant secret (`RestaurantMarketplaceIntegration.encryptedCredentials`)
  reuses `credentialEncryption.ts` (AES-256-GCM) verbatim and is stripped from every API response.
- Tenant scoping: every integration/mapping row carries `restaurantId`/`businessId`; the
  `/restaurants/:restaurantId/marketplace-integrations` routes go through the same
  `requireTenantMatch`/`requireTenantPermission` middleware (agency-aware) as every other
  location-scoped route.
- RBAC: new `restaurant.marketplace.read`/`.manage` permissions, tiered like
  `restaurant.menu.write`/`restaurant.promotions.manage` — **not** excluded from agency roles the
  way `restaurant.payments.manage` is, since a marketplace integration record never holds a
  restaurant's own payment/courier secret (see `agencyRbac.ts`'s doc comment for the full reasoning).
- Webhook auth: real signature/token verification per provider (Uber Eats HMAC-SHA256, DoorDash
  JWT, foodpanda static token), constant-time comparison throughout.
- Idempotency: `MarketplaceWebhookEvent`'s atomic-claim pattern (mirrors
  `subscription.service.ts`'s billing-webhook idempotency, not the weaker delivery-webhook
  bare-insert pattern) plus a DB-level unique index on `Order` (`marketplace.provider` +
  `marketplace.externalOrderId`) as a second, independent backstop against duplicate order creation.

## Explicitly out of scope this phase

- Two-way order-status push (staff progressing an order → notifying the marketplace). Natural
  future hook point: `orderTransition.service.ts`'s `applyOrderStatusTransition`, symmetric to how
  it already triggers `delivery.dispatch_create` on the "ready" transition.
- A polished marketplace dashboard — `apps/admin/src/pages/MarketplaceIntegrationsPage.tsx` is
  deliberately a single simple page (three provider cards: status/connect/disconnect/sync/last
  error), per this phase's own scope.
- Any claim of production readiness for a specific provider without that provider's own approval/
  certification process having actually happened.
