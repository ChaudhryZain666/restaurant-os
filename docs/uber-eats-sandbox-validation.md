# Uber Eats Marketplace — sandbox validation

Uber asked for a separate **TESTING** application on which our Eats Marketplace endpoints have been
tested, before it validates and grants production scopes to production application
`6fCJEcDVQScCjJzs1qB9ICud5mNt8DXA`.

- Test app: **GarnishTable Eats Sandbox** (Eats Marketplace, Testing)
- Test Client ID: `8V7ei2htyv6F3lyq39wu0M5ElNzwZRUc`

**Status (2026-10-25):** authentication works, but Uber has provisioned **no sandbox test store** to
the app (`GET /v1/eats/stores` returns `{"stores":[]}`). Every store, menu, order and activation
endpoint is therefore untested against Uber. End-to-end validation is **not** complete.

## Environments

| | Sandbox (testing) | Production |
|---|---|---|
| OAuth host | `https://sandbox-login.uber.com` | `https://auth.uber.com` |
| API host | `https://test-api.uber.com` | `https://api.uber.com` |
| Selected by | `UBER_EATS_ENVIRONMENT=sandbox` (default) | `UBER_EATS_ENVIRONMENT=production`, refused unless `NODE_ENV=production` |

- **Where the hosts are defined:** every Uber Eats URL comes from
  `apps/api/src/marketplaceProviders/uberEatsHosts.ts`.
- **Mixing environments fails:** a sandbox token works only on the sandbox API host.
- **Production makes no Uber calls:** it runs `MARKETPLACE_PROVIDER_MODE=mock`.

## Receiving Uber sandbox webhooks on a production deployment

Settings for that deployment:
- `MARKETPLACE_PROVIDER_MODE=mock` — unchanged, so DoorDash and foodpanda stay mock and their
  webhooks keep returning 404.
- `UBER_EATS_PROVIDER_MODE=live`
- `UBER_EATS_ENVIRONMENT=sandbox`
- The TESTING app's `UBER_EATS_CLIENT_ID` and `UBER_EATS_CLIENT_SECRET`.

Result:
- `POST /api/v1/webhooks/marketplace/uber_eats` verifies Uber's `X-Uber-Signature` with the real
  adapter: 200 with an empty body when valid, 400 when not.
- **Restaurant connections stay closed:** while production runs Uber Eats against the sandbox, Uber
  Eats shows no connect option (`not_available`), and connect-start, callback and store-select return
  403 (`providerMode.ts`).

This is a separate deployment decision. It isn't applied to production by this change.

## How to run the checks

The test credentials live in `apps/api/.env` (gitignored): `UBER_EATS_TEST_CLIENT_ID` and
`UBER_EATS_TEST_CLIENT_SECRET`. Never commit them, paste them into tickets, or put them in the Postman
files.

### Sandbox script (no store needed for steps 1–2)

```
npm run -w apps/api uber-eats:sandbox-check                                   # token + list stores
UBER_EATS_TEST_STORE_ID=… npm run -w apps/api uber-eats:sandbox-check -- --menu
UBER_EATS_TEST_STORE_ID=… npm run -w apps/api uber-eats:sandbox-check -- --order <order_id> --accept
```

### Postman / newman

- **Collection:** `docs/postman/uber-eats-sandbox.postman_collection.json`, 28 requests in 9 groups.
- **Environment template:** `docs/postman/uber-eats-sandbox.postman_environment.json`.

Setup in Postman:
1. Import both files.
2. In the environment, set `client_secret` (type *secret*) from your own copy of the credentials.
3. Run the collection.

Tokens are saved into secret-type variables and never logged.

**Safety built into the collection**
- A collection-level guard resolves each request's URL and skips anything that isn't
  `sandbox-login.uber.com`, `test-api.uber.com` or `localhost`. It was verified by pointing
  `api_base_url` at `example.com`: 0 requests were sent.
- A request whose resource variable is empty (`store_id`, `order_id`, `auth_code`, `redirect_uri`,
  `merchant_access_token`) is **skipped**, not sent with a blank or placeholder ID.

**Running it from the command line**
```
npx newman@6.2.1 run docs/postman/uber-eats-sandbox.postman_collection.json \
  -e docs/postman/uber-eats-sandbox.postman_environment.json \
  --env-var "client_secret=$UBER_EATS_TEST_CLIENT_SECRET" \
  --env-var "redirect_uri=http://localhost:5174/marketplace/oauth-callback"
```

Group 9 (webhooks) needs the local API running in live sandbox mode:
```
MARKETPLACE_PROVIDER_MODE=live UBER_EATS_ENVIRONMENT=sandbox \
UBER_EATS_CLIENT_ID=<test id> UBER_EATS_CLIENT_SECRET=<test secret> npm run -w apps/api dev
```

Once Uber provisions a test store, set `store_id`, upload the menu, place an order (below), set
`order_id`, and re-run.

**Placing a test order** (Uber webhooks guide): sign in to the Uber Eats app with the test developer
account, set the delivery address to the test store's address, and order. No payment is needed.
Uber then posts `orders.notification` to the app's **Webhooks → Primary Webhook URL** (Developer
Dashboard → app → Setup).

## Real sandbox results (newman, 2026-10-25)

13 real HTTP requests, 23 assertions, 0 failed. "Real" means an actual network call, to Uber's
sandbox or to our local API. Mocked unit tests are listed separately below.

| # | Group | Request | Grant / scope | HTTP | Result |
|---|---|---|---|---|---|
| 1 | Auth | `POST sandbox-login…/oauth/v2/token` | client_credentials · `eats.store eats.order` | 200 | **PASS** — both scopes granted, `expires_in` 2592000 |
| 2 | Auth | same | client_credentials · `eats.store.orders.read` | 200 | **PASS** — granted |
| 3 | Auth | same | client_credentials · `eats.store.status.write` | 200 | **PASS** — granted |
| 4 | Auth | same | client_credentials · `eats.report` | 200 | **PASS** — granted |
| 5 | Auth | same | client_credentials · `eats.pos_provisioning` | 400 | **PASS (expected)** — `invalid_scope`: this scope isn't available via client_credentials |
| 6 | Auth | same, wrong secret | client_credentials | 403 | **PASS (expected)** — rejected, no token |
| 7 | Auth | `GET test-api…/v1/eats/stores`, no token | — | 401 | **PASS (expected)** |
| 8 | Stores | `GET /v1/eats/stores` | `eats.store` | 200 | **PASS as a call** — `{"stores":[]}`: **no test store provisioned**. Not a store test. |
| 9 | POS provisioning | `GET sandbox-login…/oauth/v2/authorize` (code, `eats.pos_provisioning`) | authorization_code | 302 | **PASS (partial)** — redirects to Uber's hosted login. A real merchant login hasn't happened; the redirect URI is only checked after login. |
| 10 | Webhook (local) | Uber's documented `orders.notification`, signed with the test secret | X-Uber-Signature | 200 | **PASS** — empty body, as Uber requires |
| 11 | Webhook (local) | bad signature | — | 400 | **PASS** |
| 12 | Webhook (local) | same `event_id` delivered twice | — | 200, 200 | **PASS** — stored once, marked processed (checked in the local DB) |

**Blocked: no requests sent** (each needs a resource only Uber can provide)

| Group | Requests | Needs |
|---|---|---|
| 2 Store details | `GET /v1/eats/stores/{store_id}` | test store |
| 3 Store status | `GET /v1/eats/store/{store_id}/status` (`eats.store`), `POST …/status` (`eats.store.status.write`) | test store |
| 4 Menu | `PUT /v2/eats/stores/{store_id}/menus`, `GET …/menus` | test store |
| 5 Item availability | `POST /v2/eats/stores/{store_id}/menus/items/{item_id}` (suspend, then un-suspend) | test store + uploaded menu |
| 6 Orders | `GET /v2/eats/order/{order_id}`, `POST /v1/eats/orders/{id}/accept_pos_order`, `…/deny_pos_order` | test orders, and the app activated as order manager |
| 7 Created orders | `GET /v1/eats/stores/{store_id}/created-orders` (`eats.store.orders.read`) | test store |
| 8 POS provisioning | code exchange, merchant `GET /v1/eats/stores`, `POST`/`GET /v1/eats/stores/{store_id}/pos_data` | test store **and** a test merchant login, plus our redirect URI registered on the test app |
| Webhooks from Uber | `orders.notification`, `store.provisioned`, etc. delivered by Uber | test store, a test order, and a Primary Webhook URL Uber can reach |

Placeholder-ID requests made earlier (404 `not_found`) only show the host answers. They are **not**
evidence that those endpoints work.

## Scopes

Each scope was verified with its own token request (rows 1–5).

| Scope | Grant | Uber endpoints | GarnishTable uses it for | Needed? |
|---|---|---|---|---|
| `eats.store` | client_credentials | stores, store details and status (GET), menu upload/retrieve, item update | menu sync, item availability, store listing | **Yes** |
| `eats.order` | client_credentials | order details (v2), accept, deny, cancel | order ingestion, accept, deny | **Yes** |
| `eats.pos_provisioning` | **authorization_code** (merchant user) | merchant `GET /stores`, `POST`/`DELETE /pos_data` | restaurant "Connect Uber Eats" and store activation | **Yes** |
| `eats.store.orders.read` | client_credentials | created-orders, canceled-orders, order details | — (we are webhook-driven) | No |
| `eats.store.status.write` | client_credentials | `POST /store/{id}/status` | — (not implemented) | No |
| `eats.report` | client_credentials | reporting | — (not implemented; Uber's Request Report reference currently 404s) | No |

**Recommended minimum for production:** `eats.store`, `eats.order`, `eats.pos_provisioning`.

The app token requests only `eats.store eats.order`, because asking for an ungranted scope fails the
whole token request.

## Merchant authorization (eats.pos_provisioning), reviewed

The flow, matching the dashboard's Authorization Code steps:
1. **Authorize.** `POST /restaurants/:id/marketplace-integrations/uber_eats/connect/start` mints a
   one-time state. It is 32 random bytes, stored only as a hash, valid for 15 minutes, and tied to the
   signed-in user, the restaurant and the redirect URI. The browser is then sent to
   `{auth}/oauth/v2/authorize?client_id&response_type=code&scope=eats.pos_provisioning&redirect_uri&state`.
2. **Callback.** The admin page `/marketplace/oauth-callback` takes `code` and `state` and immediately
   clears them from the address bar.
3. **Code exchange.** `POST /marketplace-oauth/uber_eats/callback` (server side) consumes the state
   atomically, so it's single-use and a replay fails. It rejects a state started by another user, then
   exchanges the code at `{auth}/oauth/v2/token` (`grant_type=authorization_code`, client secret,
   identical `redirect_uri`). Uber's codes expire in 10 minutes and are single-use.
4. **Discover stores.** `GET /v1/eats/stores` with the merchant token. Several stores → the owner picks one.
5. **Activate.** `POST /v1/eats/stores/{store_id}/pos_data` with the merchant token (`is_order_manager`,
   `integrator_store_id`). If this fails, the integration is **not** recorded as connected.
6. **Store the token.** The merchant token is encrypted at rest (`CREDENTIAL_ENCRYPTION_KEY`) and
   stripped from every API response. Logs contain HTTP statuses only, never codes, tokens or secrets.

**Redirect URI:**
- Production: `UBER_EATS_REDIRECT_URI`, or by default `${ADMIN_ORIGIN}/marketplace/oauth-callback` =
  `https://app.garnishtable.com/marketplace/oauth-callback`.
- Local sandbox testing: `http://localhost:5174/marketplace/oauth-callback`.

The redirect URI must exactly match one registered on the Uber app.

## Defects fixed on this branch (found against Uber's reference)

1. **Webhooks were always rejected.** The store and order were read from top-level fields; Uber sends
   `meta.user_id` and `meta.resource_id`.
2. **Order endpoints were wrong.** We used `/v1/eats/stores/{s}/orders/{o}`. The correct paths are
   `GET /v2/eats/order/{id}` and `POST /v1/eats/orders/{id}/accept_pos_order|deny_pos_order`. These
   return 204, which we treated as an unreadable response.
3. **Every order would have been denied.** We matched cart lines by per-cart `instance_id` instead of
   the uploaded item `id`.
4. **Cancellations were treated as new orders.** `orders.cancel` was ingested and accepted.
5. **Menu upload and item availability used undocumented paths and payloads.** They now use the v2
   MenuConfiguration and `suspension_info`.
6. **Store activation (`pos_data`) was missing.** Without it there are no webhooks and no order-manager
   rights.
7. **Hosts were hardcoded to production, with no sandbox.** `eats.report` was also requested without
   being used.
8. **The webhook acknowledgement wasn't empty.** It now returns 200 with an empty body, as Uber requires.

## Unproven until a test store exists

- Whether Uber accepts `tax_info: {}` on menu items: `tax_info` is required, but its fields are optional.
- Whether `pos_data` takes `is_order_manager`/`integrator_store_id` as query parameters or as a JSON body.
  We send both.
- Real field values in a sandbox order.

## Mocked automated tests (no network)

`UberEatsProvider.test.ts`, `uberEatsConnect.test.ts`, `marketplaceOAuth.controller.test.ts` and
`marketplaceWebhook.controller.test.ts` pin every request shape above. They are regression tests, not
sandbox evidence.
