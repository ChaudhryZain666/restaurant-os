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
/api/v1/restaurants/by-domain/:hostname           GET     Public — Phase 22 custom-domain storefront resolution, same trust model/response shape as by-slug; only an ACTIVE verified domain resolves

# Phase 22 — custom domains (one active domain per location; see docs/multi-tenant-storefront-architecture.md)
/api/v1/businesses/:businessId/domains                        GET   requires requireBusinessMatch + restaurant.settings.manage — every domain across the business's locations
/api/v1/restaurants/:restaurantId/domains                     POST  requires tenant match + restaurant.settings.manage (owner-only) — {hostname}, starts pending_verification
/api/v1/restaurants/:restaurantId/domains/:id/check-verification POST requires tenant match + restaurant.settings.manage — synchronous DNS TXT check, idempotent, never auto-activates
/api/v1/restaurants/:restaurantId/domains/:id/activate        POST  requires tenant match + restaurant.settings.manage — only from verified; 409 if the location already has a different active domain
/api/v1/restaurants/:restaurantId/domains/:id/deactivate      POST  requires tenant match + restaurant.settings.manage — active -> verified
/api/v1/restaurants/:restaurantId/domains/:id                 DELETE requires tenant match + restaurant.settings.manage — hard delete, frees the hostname

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

# Phase 23 — business-wide analytics + promotions
/api/v1/businesses/:businessId/analytics/overview  GET  ?from=&to=&locationIds= — requires requireBusinessMatch + restaurant.analytics.read — revenue/AOV grouped by currency, never blended
/api/v1/businesses/:businessId/analytics/trends    GET  same auth — per-day series, currency-grouped
/api/v1/businesses/:businessId/analytics/products  GET  same auth — business-wide top-selling items
/api/v1/businesses/:businessId/promotions          GET/POST     requires requireBusinessMatch + restaurant.promotions.manage — POST body includes locationIds (the selected subset, validated to belong to this business)
/api/v1/businesses/:businessId/promotions/:id      PATCH/DELETE same auth
/api/v1/restaurants/:restaurantId/promotions       GET   also returns any business promotion targeting this location, tagged scope:"business" alongside this location's own scope:"location" rows (Phase 23) — unchanged otherwise

/api/v1/restaurants/:restaurantId/orders          POST    Any authenticated customer (ordering FROM this restaurant)
/api/v1/restaurants/:restaurantId/orders          GET     requires restaurant.orders.read + tenant match
/api/v1/restaurants/:restaurantId/orders/:id/status PATCH requires restaurant.orders.manage + tenant match
/api/v1/orders/mine                               GET     The caller's own orders, across all restaurants — paginated (?page&limit)
/api/v1/orders/:id                                GET     Owner, or staff of that order's restaurant

/api/v1/restaurants/:restaurantId/customers       GET     requires restaurant.orders.read + tenant match — paginated/searchable, aggregated from Orders (not a stored entity)

/api/v1/restaurants/:restaurantId/loyalty/me         GET  The caller's loyalty account at this restaurant
/api/v1/restaurants/:restaurantId/loyalty/me/history GET

# Phase 24 — billing & subscription foundation (see docs/multi-tenant-storefront-architecture.md); no subscription id in the URL — a business has at most one live subscription (DB-enforced)
/api/v1/businesses/:businessId/subscription               GET   requires requireBusinessMatch + billing.read (owner+manager)
/api/v1/businesses/:businessId/subscription               POST  requires requireBusinessMatch + billing.manage (owner-only) — {planCode, billingInterval}, starts against the mock provider
/api/v1/businesses/:businessId/subscription/cancel         POST  billing.manage — active->cancelling (scheduled) or trialing/past_due->cancelled (immediate)
/api/v1/businesses/:businessId/subscription/reactivate      POST  billing.manage — cancelling->active
/api/v1/businesses/:businessId/subscription/change-plan     POST  billing.manage — {planCode}
/api/v1/businesses/:businessId/subscription/entitlements    GET   billing.read
/api/v1/businesses/:businessId/subscription/mock-advance    POST  billing.manage — dev/test only, only mounted when BILLING_PROVIDER=mock; {status}
/api/v1/webhooks/billing/:provider                          POST  Public — signature-verified only, mirrors /webhooks/payments/:provider
/api/v1/plans                                                GET   Any authenticated user — read-only Plan catalog (no pricing guaranteed present)
/api/v1/platform/subscriptions                               GET   platform.restaurants.manage — paginated, read-only, every business's subscription

# Phase 25 — agency foundation (see docs/multi-tenant-storefront-architecture.md); Agency -> Business -> Location, business-level access only (never location-operational — see the phase's documented boundary)
/api/v1/agencies                                              POST  requireAuth (role must be customer/agency_member) — self-serve, caller becomes agency_owner
/api/v1/agencies/me                                           GET   requireAuth — every agency the caller has an ACTIVE membership in, with their role
/api/v1/agencies/:agencyId                                    GET   requireAgencyMatch (any active membership)
/api/v1/agencies/:agencyId/businesses                         GET   requireAgencyMatch — per-business summaries (location count, subscription status) — NOT a revenue rollup
/api/v1/agencies/:agencyId/businesses                         POST  requireAgencyMatch + agency.businesses.manage — transactional: owner User + Business + first Restaurant, atomic max_businesses guard
/api/v1/agencies/:agencyId/audit-log                          GET   requireAgencyMatch — paginated AgencyAuditLog
/api/v1/agencies/:agencyId/members                            GET   requireAgencyMatch
/api/v1/agencies/:agencyId/members                            POST  requireAgencyMatch + agency.members.manage — invites a new or existing eligible account
/api/v1/agencies/:agencyId/members/:membershipId              PATCH requireAgencyMatch + agency.members.manage — role/status/businessIds (guards against removing the last active owner)
/api/v1/agencies/accept-invite                                POST  Public — signature-style token, mirrors /auth/accept-invite's atomic double-accept protection
/api/v1/agencies/:agencyId/subscription                       GET/POST/.../cancel/.../reactivate/.../change-plan/.../entitlements — mirrors /businesses/:businessId/subscription exactly, gated by agency.billing.read/manage
/api/v1/platform/agencies                                     GET   platform.restaurants.manage — paginated, read-only, business/member counts per agency

# Phase 26 — agency LOCATION-operational access (crosses Phase 25's "business-level only" boundary)
/api/v1/agencies/:agencyId/businesses/:businessId              GET   requireAgencyMatch — business detail: owner status, full locations list, subscription snapshot; 404s (not 403) for a business under a different agency
/api/v1/agencies/:agencyId/businesses/:businessId/resend-owner-invite POST requireAgencyMatch + agency.businesses.manage — mirrors platform.controller.ts's/staff.controller.ts's resend pattern
# Every /restaurants/:restaurantId/... route (orders, tables, staff, location domains — see above)
# is now agency-aware too: requireTenantMatch's canAccessRestaurant gained an agency branch
# reusing businessLocation.ts's agencyGrantsBusinessAccess one hop deeper, and orders/tables/staff/
# restaurantDomain routers swapped requirePermission for the new requireTenantPermission, which
# checks the SAME AGENCY_ROLE_GRANTS map requireBusinessPermission already used (renamed from
# AGENCY_ROLE_BUSINESS_GRANTS since it now governs both scopes). No new route paths for these —
# same URLs, now reachable by an authorized agency member too.

# Phase 27 — commercial billing: real (proposed) pricing, checkout, entitlement enforcement, billing history
/api/v1/businesses/:businessId/subscription/checkout          POST  billing.manage — {planCode, billingInterval}; creates NO Subscription — only the provider's webhook completing checkout does
/api/v1/businesses/:businessId/subscription/billing-history   GET   billing.read — paginated BillingHistoryEvent (also the Invoices list — payment_succeeded rows carry receiptUrl)
/api/v1/businesses/:businessId/locations/limit                GET   restaurant.settings.manage — {max, current, canCreate}; a pre-check only, never authoritative (reserveLocationSlot is)
/api/v1/agencies/:agencyId/subscription/checkout               POST  agency.billing.manage — mirrors the business checkout route
/api/v1/agencies/:agencyId/subscription/billing-history        GET   agency.billing.read — mirrors the business billing-history route
/api/v1/billing/mock-checkout/:token/complete                  POST  Public (opaque token only) — only mounted when BILLING_PROVIDER=mock; drives the real webhook path, mirrors mock-advance
/api/v1/platform/revenue                                       GET   platform.restaurants.manage — currency-grouped MRR (sumAmountsByCurrency), never a blended total
# custom_domains (restaurantDomain POST), business_analytics (businessAnalytics router),
# business_promotions (businessPromotion router) are now entitlement-gated too, via the new
# requireEntitlement middleware (entitlementLimit.service.ts) — same URLs, no new paths, but a
# subscription whose plan explicitly lacks the entitlement now gets a real 403 where it previously
# always passed. A business with NO subscription at all is never affected (generous default-allow).

# Phase 28 — agency commercial flow, product completion
/api/v1/agencies/:agencyId/dashboard                           GET   requireAgencyMatch — subscription/plan, business usage vs. limit, location totals, active/needing-setup counts, domains configured, pending invitations
/api/v1/agencies/:agencyId/members/:membershipId/resend-invite POST  agency.members.manage — mirrors the business owner-invite resend
/api/v1/agencies/:agencyId/businesses                          POST  agency.businesses.manage — gained provisioningMode:"invite"|"direct"; "direct" returns ownerTemporaryPassword once, never persisted in plaintext
/api/v1/public/plans                                           GET   Public, unauthenticated — stripped Plan catalog (code/name/description/pricing/entitlements/trialDays only) for the marketing site; distinct from the auth-gated /plans
/api/v1/platform/analytics                                     GET   platform.restaurants.manage — subscription-status breakdown, total locations, agency-vs-direct split, 30-day signups trend
/api/v1/platform/config                                        GET   platform.restaurants.manage — read-only, curated non-secret env subset (provider selections, trial/grace-period defaults); never credentials
/api/v1/restaurants/:restaurantId/setup-checklist               GET   restaurant.settings.manage — extended, non-gating "more setup" checklist alongside /readiness
/api/v1/restaurants/:restaurantId/loyalty/rewards               GET   Public (authenticated customer) — active LoyaltyReward catalog for this restaurant
/api/v1/restaurants/:restaurantId/loyalty/rewards/admin         GET   restaurant.loyalty.manage — every reward including inactive
/api/v1/restaurants/:restaurantId/loyalty/rewards                POST  restaurant.loyalty.manage — create a reward
/api/v1/restaurants/:restaurantId/loyalty/rewards/:rewardId      PATCH restaurant.loyalty.manage — edit/toggle a reward
/api/v1/restaurants/:restaurantId/loyalty/rewards/:rewardId      DELETE restaurant.loyalty.manage
# /auth/me and /auth/change-password remain the only two routes a mustChangePassword:true session
# (an agency-provisioned "direct access" owner who hasn't set a real password yet) can reach —
# enforced in middleware/auth.ts, independent of the client-side RequireAuth redirect.
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

## Billing (Phase 24 foundation; Phase 27 — real pricing, checkout, entitlement enforcement)

`apps/api/src/billing/` defines a provider-agnostic `BillingProvider` interface — deliberately
separate from `apps/api/src/payments/PaymentProvider.ts`. Customer-order payments and platform
subscription billing are different financial domains with different lifecycles, different webhook
streams (`BillingWebhookEvent` vs `PaymentWebhookEvent`), and different idempotency stores; mixing
them would make either one harder to reason about safely. `MockBillingProvider` is the only provider
this project's own tests select. `PaddleBillingProvider` (Phase 27, `BILLING_PROVIDER=paddle`) is
real, network-capable code against Paddle's documented Billing API v2 — but has never been
exercised against a live account (see that file's header comment). `Plan.pricing` now carries
PROPOSED (not commercially final) pricing on the seeded catalog — see `docs/commercial-decisions.md`
for every number and every still-open decision. Two creation paths exist: the original no-card
trial-first `POST .../subscription`, and Phase 27's payment-method-up-front `POST .../subscription/
checkout` (creates nothing until the provider's webhook reports completion). Feature entitlements
(`custom_domains`/`business_analytics`/`business_promotions`) are now actually enforced via
`requireEntitlement` (`entitlementLimit.service.ts`) — the first real callers of the entitlement
mechanism since Phase 24 built it inert. Webhooks land at `POST /webhooks/billing/:provider` (no
auth — signature-verified instead, same shape as the payment webhook route). See
`docs/multi-tenant-storefront-architecture.md`'s Phase 24 and Phase 27 sections for the full domain
model, lifecycle state machine, entitlement/limit mechanism, and checkout design.

## Agencies (Phase 25 — Agency → Business → Location; Phase 26 — location-operational access)

An Agency organizationally manages zero or more Businesses (`Business.agencyId`, additive and
optional — never replaces `Business.ownerId`, the real business-owner). Membership is explicit
(`AgencyMembership`, mirrors `User.locationIds`' implicit-owner/explicit-staff shape) and carried as
an array claim on the JWT (`agencyMemberships`), never a singular field, since one person can hold
independent roles across multiple agencies. `requireBusinessMatch()` (used by every
`/businesses/:businessId/...` route already documented above) gained one extra branch so an agency
member reaches exactly the businesses their agency manages — no separate authorization system, no
per-route changes.

Phase 25 deliberately stopped this at **business-level only** (settings/menu/analytics/promotions/
billing). Phase 26 crossed that boundary for **location-operational** access (orders/kitchen/tables/
staff/location domains): `middleware/tenant.ts`'s `canAccessRestaurant`/`requireTenantMatch` gained
the identical kind of branch, reusing `businessLocation.ts`'s `agencyGrantsBusinessAccess` one hop
deeper (Restaurant → businessId → Business → agencyId → membership) rather than a second
authorization system. A single `AGENCY_ROLE_GRANTS` map (renamed from `AGENCY_ROLE_BUSINESS_GRANTS`)
now governs both scopes via `requireBusinessPermission`/`requireTenantPermission`, since `Permission`
is one flat vocabulary reused at both levels. `agency_owner`/`agency_admin` get orders/tables
management (owner-only also gets staff management); `agency_staff` gets orders read-only, still
gated behind the same explicit `AgencyMembership.businessIds` assignment Phase 25 established — no
new location-level assignment axis. `restaurant.payments.manage` is granted to no agency role,
deliberately. The Socket.IO handshake now carries `agencyMemberships` too, so a client-requested
`locationId` resolves correctly for an agency member exactly like it already did for a real
restaurant-role account. See `docs/multi-tenant-storefront-architecture.md`'s Phase 25 and Phase 26
sections for the full domain model, concurrency guarantees, and an honest answer to every scope
question each phase was asked to resolve.

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
