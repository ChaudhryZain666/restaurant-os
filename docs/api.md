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

/api/v1/restaurants                               POST    platform_admin only
/api/v1/restaurants/me                            GET     Requires auth (restaurant-scoped)
/api/v1/restaurants/by-slug/:slug                 GET     Public

/api/v1/restaurants/:restaurantId/menu            GET     Public, Redis-cached
/api/v1/restaurants/:restaurantId/menu            POST    requires restaurant.menu.write + tenant match
/api/v1/restaurants/:restaurantId/menu/:id        PATCH   requires restaurant.menu.write + tenant match
/api/v1/restaurants/:restaurantId/menu/:id        DELETE  requires restaurant.menu.write + tenant match

/api/v1/restaurants/:restaurantId/orders          POST    Any authenticated customer (ordering FROM this restaurant)
/api/v1/restaurants/:restaurantId/orders          GET     requires restaurant.orders.read + tenant match
/api/v1/restaurants/:restaurantId/orders/:id/status PATCH requires restaurant.orders.manage + tenant match
/api/v1/orders/mine                               GET     The caller's own orders, across all restaurants
/api/v1/orders/:id                                GET     Owner, or staff of that order's restaurant

/api/v1/restaurants/:restaurantId/loyalty/me         GET  The caller's loyalty account at this restaurant
/api/v1/restaurants/:restaurantId/loyalty/me/history GET
```

## Background jobs (BullMQ)

One queue exists today (`notifications`), with a single demo processor (`demo.ping`) that proves
the enqueue → process → log path works end-to-end. It is **not** wired into any real event yet —
see `apps/api/src/queues/notification.queue.ts`'s comment. Real job types (`SendEmail`,
`SendSMS`, `SendWhatsApp`, `ProcessOrderEvent`, `UpdateAnalytics`) get added to that file as each
feature that needs them is actually built. The worker currently runs in the same process as the
API (`startNotificationWorker()` in `index.ts`) — splitting it into a separate worker process is
a one-line change (`node dist/queues/worker.js` instead of embedding it) once job volume justifies it.

## Real-time (Socket.IO)

`apps/api/src/realtime/socket.ts` sets up an authenticated Socket.IO server: the handshake must
carry a valid access token (`socket.handshake.auth.token`), and each connection joins a
`user:<id>` room and (for restaurant-scoped roles) a `restaurant:<id>` room. No business events
are emitted yet — order-status events (`order.created`, `order.confirmed`, ...) get added once
the order engine actually needs to push updates.

## File storage

`apps/api/src/storage/` defines a provider-agnostic `StorageService` interface
(`upload`/`delete`/`getUrl`) with one implementation (`S3StorageService`) that works against AWS
S3 directly or any S3-compatible provider (Cloudflare R2, MinIO) by setting `STORAGE_ENDPOINT`.
`getStorageService()` throws only when actually called without `STORAGE_BUCKET`/
`STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` configured — the app boots fine without them, since
nothing uses storage yet (menu item images are still a bare `imageUrl` string field).
