# API

- **Versioning**: everything lives under `/api/v1`. `/health` is unversioned (infra/load-balancer
  probes shouldn't need to know the API version).
- **Docs**: Swagger UI at `/api/docs`, generated from `docs/openapi.yaml` (hand-maintained, not
  auto-generated from route decorators — Express doesn't have NestJS's decorator metadata to
  generate from). Keep it in sync when adding/changing routes; it currently covers auth,
  restaurants, menu, orders, and loyalty in full.
- **Response envelope, RBAC, multi-tenancy**: see `docs/architecture.md`.

## Route map

```
/health                                          GET     Mongo + Redis connectivity check

/api/v1/auth/register                            POST    Create a customer account
/api/v1/auth/login                                POST
/api/v1/auth/refresh                              POST    Reads the httpOnly refresh cookie
/api/v1/auth/logout                               POST
/api/v1/auth/me                                   GET     Requires auth
/api/v1/auth/change-password                      POST    Requires auth + current password
/api/v1/auth/request-email-change                 POST    Requires auth + current password; emails a link to the NEW address
/api/v1/auth/confirm-email-change                 POST    Public — token from the emailed link is the credential
/api/v1/auth/me                                   DELETE  Requires auth + current password; customer role only (anonymizes, doesn't hard-delete)

/api/v1/restaurants                               POST    platform_admin only
/api/v1/restaurants/me                            GET     Requires auth (restaurant-scoped)
/api/v1/restaurants/by-slug/:slug                 GET     Public

/api/v1/restaurants/:restaurantId/menu            GET     Public, Redis-cached — dual-path: canonical (shared) menu once the business is migrated, legacy per-location menu otherwise
/api/v1/restaurants/:restaurantId/menu            POST    requires restaurant.menu.write + tenant match — 410 MENU_MIGRATED once the business is migrated (Phase 21); use the canonical/override routes below instead
/api/v1/restaurants/:restaurantId/menu/:id        PATCH   requires restaurant.menu.write + tenant match — same 410 retirement
/api/v1/restaurants/:restaurantId/menu/:id        DELETE  requires restaurant.menu.write + tenant match — same 410 retirement

# Phase 21 — shared canonical menu + per-location overrides (categories/menu/modifiers all follow this same split)
/api/v1/businesses/:businessId/categories                                  GET/POST      requires requireBusinessMatch + restaurant.categories.write (POST only)
/api/v1/businesses/:businessId/categories/:id                              PATCH/DELETE  requires requireBusinessMatch + restaurant.categories.write
/api/v1/businesses/:businessId/menu                                        GET/POST      requires requireBusinessMatch + restaurant.menu.write (POST only)
/api/v1/businesses/:businessId/menu/:id                                    PATCH/DELETE  requires requireBusinessMatch + restaurant.menu.write
/api/v1/businesses/:businessId/menu/:menuItemId/modifiers                  GET/POST      requires requireBusinessMatch + restaurant.modifiers.write (POST only)
/api/v1/businesses/:businessId/menu/:menuItemId/modifiers/:id              PATCH/DELETE  requires requireBusinessMatch + restaurant.modifiers.write
/api/v1/restaurants/:restaurantId/categories/:categoryId/override          PUT/DELETE    requires tenant match + restaurant.categories.write — atomic upsert; PUT merges ($set), DELETE restores pure inheritance
/api/v1/restaurants/:restaurantId/menu/:menuItemId/override                PUT/DELETE    requires tenant match + restaurant.menu.write
/api/v1/restaurants/:restaurantId/menu/:menuItemId/modifiers/:id/override  PUT/DELETE    requires tenant match + restaurant.modifiers.write
/api/v1/restaurants/:restaurantId/menu/overrides                          GET            requires tenant match + restaurant.menu.read — every override row for this location in one call: {categoryOverrides, menuItemOverrides, modifierGroupOverrides}

/api/v1/restaurants/:restaurantId/orders          POST    Any authenticated customer (ordering FROM this restaurant)
/api/v1/restaurants/:restaurantId/orders          GET     requires restaurant.orders.read + tenant match
/api/v1/restaurants/:restaurantId/orders/:id/status PATCH requires restaurant.orders.manage + tenant match
/api/v1/orders/mine                               GET     The caller's own orders, across all restaurants — paginated (?page&limit)
/api/v1/orders/:id                                GET     Owner, or staff of that order's restaurant

/api/v1/restaurants/:restaurantId/customers       GET     requires restaurant.orders.read + tenant match — paginated/searchable, aggregated from Orders (not a stored entity)

/api/v1/restaurants/:restaurantId/loyalty/me         GET  The caller's loyalty account at this restaurant
/api/v1/restaurants/:restaurantId/loyalty/me/history GET
```

Also present but not fully mapped here (this route map predates Phases 3–11 and was never
backfilled — see the individual feature docs instead: `docs/delivery-architecture.md`,
`docs/qr-dine-in-architecture.md`, `docs/multi-tenant-storefront-architecture.md`): categories,
modifiers, tables, delivery, geocoding, promotions, staff, support (customer + restaurant +
platform-admin), knowledge base, payments (+ webhook), platform admin (restaurants/users
management), and `/restaurants/:restaurantId/audit-log` (GET, requires `restaurant.audit.read` +
tenant match — paginated, `?targetType`/`?targetId`/`?action`/`?actorUserId`/`?startDate`/`?endDate`
filters (the last four added Phase 15); see `docs/pagination-and-rbac-architecture.md`). `/platform/restaurants` and `/platform/users` are
also paginated/searchable/filterable as of Phase 12 (same doc).

## Background jobs (BullMQ)

**Corrected Phase 16 — this section was stale.** A real `orderEventBus`
(`apps/api/src/events/orderEvents.ts`) now emits 8 order lifecycle events (`order.created`,
`order.confirmed`, `order.preparing`, `order.ready`, `order.out_for_delivery`, `order.completed`,
`order.cancelled`, `order.payment_updated`) plus support-ticket events, and
`registerOrderEventListeners`/ticket equivalents (`apps/api/src/events/*Listeners.ts`) fan each one
into both a Socket.IO emit (see below) **and** a `notifications` queue job. The queue enqueue path
is real and wired to real business events, not a demo.

**What's still a gap**: the queue's worker (`apps/api/src/queues/notification.queue.ts`) only
`logger.info`s the job payload — no email/SMS/WhatsApp dispatcher actually consumes these jobs yet.
Auth-flow emails (invite, password reset, email-change) bypass this queue entirely and call
`getEmailService().send(...)` directly and synchronously from their controllers — a second,
differently-shaped pattern a future notification channel would need to know about separately from
the order/ticket event-bus path. Building the actual dispatcher (and unifying the two patterns) is
future work — the event-bus/queue seam is deliberately the attachment point for it, per the
project's "don't build WhatsApp/SMS until there's a real dispatcher to attach them to" guidance.

The worker currently runs in the same process as the API (`startNotificationWorker()` in
`index.ts`) — splitting it into a separate worker process is a one-line change
(`node dist/queues/worker.js` instead of embedding it) once job volume justifies it.

## Real-time (Socket.IO)

`apps/api/src/realtime/socket.ts` sets up an authenticated Socket.IO server: the handshake must
carry a valid access token (`socket.handshake.auth.token`), and each connection joins a
`user:<id>` room and (for restaurant-scoped roles) a `restaurant:<id>` room. **Corrected Phase 16**
— this section was stale: order-lifecycle and payment-status events are genuinely emitted today via
the same `orderEventBus` listeners described above (a new order pushes a toast to the owning
restaurant's staff, a status change pushes a live update to the customer tracking their order —
see `e2e/order-notification-toast.spec.ts` and `e2e/kitchen-realtime.spec.ts`), not a future gap.

## File storage

`apps/api/src/storage/` defines a provider-agnostic `StorageService` interface
(`upload`/`delete`/`getUrl`) with one implementation (`S3StorageService`) that works against AWS
S3 directly or any S3-compatible provider (Cloudflare R2, MinIO) by setting `STORAGE_ENDPOINT`.
`getStorageService()` throws only when actually called without `STORAGE_BUCKET`/
`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` configured.

As of Phase 15, `POST /api/v1/restaurants/:restaurantId/uploads` (multipart, fields `file` +
`purpose` — one of `logo`/`coverImage`/`menuItemImage`) actually calls it: `requireAuth` +
`requireTenantMatch()` at the route, then a purpose-specific permission check inside the
controller (`restaurant.settings.manage` for branding, `restaurant.menu.write` for item photos —
checked in-controller rather than via route middleware since the purpose isn't known until multer
has parsed the multipart body). Server-side validated: JPEG/PNG/WebP/GIF only, 5MB max. Returns
`{ url }` only — it does not itself write that URL onto the Restaurant/MenuItem document; the
caller still saves it through the existing `updateRestaurant`/`updateMenuItem` PATCH endpoints,
exactly as if a URL had been pasted in by hand.

## Payments

`apps/api/src/payments/` defines the provider-agnostic `PaymentProvider` interface. Two
implementations exist: `MockPaymentProvider` (`PAYMENT_PROVIDER=mock`, the default everywhere —
fake money, real signature/idempotency mechanics) and `SafepayProvider`
(`PAYMENT_PROVIDER=safepay` — real, network-capable code against Safepay's real hosts, but never
run against a live account; see `docs/payment-provider-decision.md`). Payment/refund routes are
mounted under `/restaurants/:restaurantId/orders/:orderId/payments`; webhooks land at
`POST /webhooks/payments/:provider` (no auth — authenticated by signature instead, read from
whichever header `PaymentProvider.signatureHeaderName` declares for the active provider).

`Restaurant.settings.cashEnabled`/`onlinePaymentEnabled` (Phase 15) gate which payment methods a
customer is offered and are re-checked server-side in `createOrder` — never trusted from the
client. Both are plain per-restaurant booleans; there is no per-restaurant provider-credential
field, since this platform uses one platform-owned payment-provider account (see
`docs/payment-provider-decision.md`'s "Restaurant payment configuration" section).

### Paid-order cancellation (Phase 17 product decision)

Cancelling an order (`order.controller.ts`'s `updateOrderStatus`/`cancelMyOrder`) never
auto-refunds it, regardless of whether the order was paid online. Loyalty points earned/redeemed
on that order are reversed automatically (a same-system accounting correction with no external
side effect — see `loyalty.service.ts`'s `reverseLoyaltyForOrderIfNeeded`), but the payment itself
is left exactly as it was. A refund only ever happens through the explicit, separate
`POST .../payments/:id/refund` action (staff clicking "Issue refund" in the admin, or a future
platform-support action) — never as a side effect of a status change.

This is deliberate, not an oversight: auto-refunding on every cancellation would remove a
restaurant's ability to withhold a refund (a no-show/late-cancellation fee, suspected fraud) and
would put a real-money external-provider network call on the synchronous path of a routine status
change, for no operational benefit over a one-click manual action. To make sure this never becomes
a silent gap in practice, the admin `OrderPaymentAdmin` component surfaces an explicit "This order
was cancelled but the payment hasn't been refunded yet" warning whenever a cancelled order's most
recent payment is still `paid` or `partially_refunded`.

## Public API / integration readiness (Phase 16 — foundation audit, not built)

No public/partner-facing API exists, and none was built this phase — this is an audit of what
exposing one later would actually require, so a future integrations phase doesn't have to first
untangle assumptions baked in today.

**What's already a reasonable foundation, reusable as-is**: consistent `/api/v1` versioning; a
single response envelope (`sendSuccess`/`ApiError`, `docs/architecture.md`); a single RBAC source
of truth (`packages/types/src/types/rbac.ts`) that any new principal type could plug into;
meaningful mutations already audit-logged (`AuditLog`, above); the order/ticket event bus described
above as the natural attachment point for a future **outbound** webhook dispatcher (notify a POS or
delivery aggregator of a new order) — it would be a new listener on `orderEventBus`, not a parallel
event system.

**What's genuinely missing for a real public/partner API** (not built, documented for later):
- **No non-human principal type.** Every request today authenticates as a `User` session JWT. A
  POS/delivery-aggregator integration needs its own credential (an API key or OAuth
  client-credentials grant) that isn't a human logging in — this needs a new principal concept
  alongside `User`, not a repurposing of the staff-invite flow.
- **No inbound webhook receiver framework beyond payment providers.** `POST /webhooks/payments/:provider`
  is provider-specific, signature-verified, and not generalized — a future POS/delivery webhook
  receiver would be a new, similarly-shaped route, not a reuse of this one.
- **No outbound webhook dispatcher** (see Background Jobs above) — only inbound.
- **No API-client-scoped rate limiting.** `authLimiter` is IP-based; a real partner API needs
  per-client quotas, which requires the principal type above to exist first.

None of this needs building until a specific integration is actually prioritized — the point of
auditing it now is only to confirm the existing architecture doesn't have to be reworked to support
it later, and it doesn't: the additions above are additive (a new principal type, a new dispatcher
listener, new routes), not replacements for anything that exists today.
