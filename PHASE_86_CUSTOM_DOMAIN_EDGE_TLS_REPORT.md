# Phase 86 — Custom Domain Edge/TLS Provisioning

Branch `phase-86-custom-domain-edge`, built on `phase-85b-docker-verification` (`19abd51`). `main`
was not changed. No production service, DNS record, certificate authority account or credential
was used.

## Status

**Implemented and verified end to end against a real ACME CA (Pebble, Let's Encrypt's test CA), on
the real production Compose stack: 81 of 81 edge checks pass** (GitHub Actions run
[37089816907](https://github.com/ChaudhryZain666/restaurant-os/actions/runs/37089816907)).

The full lifecycle was demonstrated:

1. The restaurant adds `Orders.Wildwood-Kitchen.example.` (normalized to `orders.wildwood-kitchen.example`).
2. It publishes the TXT record; real DNS verification passes; the domain is activated.
3. Caddy asks the API, which allows it; a certificate is issued on demand by the ACME CA.
4. The HTTPS storefront opens with the correct restaurant (in a browser), the API works through
   the domain, and Socket.IO receives a live order event.
5. The certificate persists across a Caddy restart and renews automatically, and renewal re-asks
   the API.
6. After deactivation: the ask check is denied, the tenant is no longer served, sockets are
   refused, and renewal is blocked.

Not yet exercised: the public Let's Encrypt CA, real public DNS, and the Hostinger server itself.
See "Production readiness".

## Implementation assessment (before changes)

| Question | Finding (in the code) |
|---|---|
| Where custom domains enter | `POST /restaurants/:id/domains` (owner, `custom_domains` entitlement) → `DomainMapping` (unique `hostname`) |
| Ownership | TXT `_garnishtable-verify.<host>` = random token; `check-verification` does a live DNS lookup (`DNS_VERIFIER=node`) → `verified` |
| Becoming active | `activate` only from `verified`; at most one active domain per location |
| Storefront resolution | the SPA calls `GET /restaurants/by-domain/<window.location.hostname>` (active mapping + active restaurant + entitlement) |
| Which host receives `/` | the storefront nginx container (`server_name _`) |
| `/api` | the same storefront container proxies it to the API |
| Socket.IO | cross-origin to `api.<domain>` (`VITE_API_URL`) |
| Does the API need the original Host? | No. Resolution uses the hostname the browser sends as a path parameter. Caddy and nginx preserve Host anyway. |
| CORS / origin | HTTP is same-origin via `/api`. Socket.IO already DB-checked custom-domain origins. |
| `CUSTOM_DOMAIN_CNAME_TARGET` | already read by the API (Phase 85A: shown to restaurants) and needed by the edge |
| What the edge must ask | "is this hostname a live custom domain?", i.e. exactly the `by-domain` decision |

**Reused unchanged:** the domain model, verification, activation, the tenant-resolution flow,
entitlement checks, and the admin UI (which already shows the CNAME record once the target is set).

## Changes

### Application (`apps/api`, `packages/validation`)

- **`services/customDomain.service.ts`** (new): `resolveCustomDomain()`, the one decision for
  "is this hostname live?", used by `by-domain`, the TLS ask check and Socket.IO. This prevents
  the edge, storefront and sockets from ever disagreeing.
- **`edge/tlsAskServer.ts`** (new): `GET /internal/tls/ask?domain=` on a **separate private
  listener** (`CUSTOM_DOMAIN_TLS_ASK_PORT`).
  - Answers 200 `ok` / 403 `denied` / 503 `unavailable`: no tenant data, no reasons, no writes;
    fails closed.
  - Started from `index.ts` and closed on graceful shutdown.
- **`controllers/restaurant.controller.ts`:** `getRestaurantByDomain` now uses the shared
  decision. Responses are unchanged.
- **`realtime/socket.ts`:** `allowRequest` refuses handshakes whose Origin isn't a GarnishTable
  surface or a live custom domain over https. CORS doesn't apply to WebSocket handshakes, so this
  is the actual enforcement. Clients without an Origin header are still token-authenticated.
- **`realtime/realtimeOrigins.ts`:** the custom-domain origin check uses the shared decision.
- **`config/env.ts`:**
  - **New setting:** `CUSTOM_DOMAIN_TLS_ASK_PORT`.
  - **Validation in every environment:** the CNAME target must be a bare public hostname, and the
    ask port must differ from `PORT`.
  - **Production requires both** `CUSTOM_DOMAIN_CNAME_TARGET` and `CUSTOM_DOMAIN_TLS_ASK_PORT`.
- **`packages/validation/src/domain.ts`:** the shared hostname validator now also rejects
  internal or reserved suffixes (`localhost`, `local`, `localdomain`, `internal`, `intranet`,
  `lan`, `arpa`, `invalid`, `test`), underscores, leading/trailing hyphens, labels over 63
  characters and names over 253. One rule set now covers the dashboard, `by-domain`, the ask check
  and sockets.

### Edge and infrastructure (`infrastructure/production/`, all new)

- **`Caddyfile`:**
  - the seven fixed hostnames (normal certificates);
  - the CNAME target (redirects to marketing);
  - a catch-all `https://` with `tls { on_demand }` → storefront;
  - `on_demand_tls { ask http://api:<port>/internal/tls/ask }`;
  - HTTP → HTTPS redirect;
  - `-Server` header, HSTS, JSON access logs.
  - All hostnames and the CA come from the environment.
- **`docker-compose.yml`:**
  - **Containers:** Caddy (the only published ports: 80, 443, 443/udp), api, web, admin,
    marketing, and optional `redis` (profile `local-redis`, password, append-only, `noeviction`).
  - **Networks:** `edge` with a fixed subnet (so `TRUST_PROXY` names it exactly), and `backend`
    marked `internal: true`, holding the API and Redis.
  - **Persistence:** `caddy_data` / `caddy_config` volumes.
  - **Operations:** health-gated start order; log rotation caps; `restart: unless-stopped`.
  - **API environment:** every origin and `TRUST_PROXY` is derived from the hostnames; secrets
    stay only in the gitignored env file.
- **`.env.example`:** every edge setting, no secrets.
- **`test/`:** a reproducible harness.
  - `docker-compose.test.yml`: Pebble, challtestsrv and a throwaway MongoDB overlay.
  - `pebble-config.json`: 240-second certificates, so renewal happens during the run.
  - `edge-e2e.sh`: 81 checks.
  - `socket-check.cjs`.

### Configuration and docs

- **Env examples:** `apps/api/.env.example` and `apps/api/.env.production.example` document the
  new variables.
- **`.gitignore`:** ignores the harness output.
- **`docs/custom-domains-operations.md`** (new): restaurant setup, the DNS model (subdomain,
  `www`, apex caveats), configuration, how the edge decides, obtaining vs. holding vs. serving
  after deactivation, the threat model, Let's Encrypt rate limits, operations (deploy, reload,
  rollback, backup and restore of certificate state, diagnosis), failure behaviour, and the
  harness.
- **Updated:**
  - `docs/custom-domains-infrastructure-contract.md`: status now implemented.
  - `docs/production-architecture.md`: the edge is now Caddy.

### Tests

- **New:**
  - `customDomain.service.test.ts` (30): the full authorization matrix, canonicalization,
    cross-tenant routing, takeover.
  - `tlsAskServer.test.ts` (5): HTTP contract, fail-closed, no data leakage.
  - `socketOrigin.test.ts` (12): polling and WebSocket, allowed and rejected origins.
- **Extended:**
  - `env.test.ts`: production requirements and validation.
  - `domainVerification.service.test.ts`: the new validator rules.
- **Adjusted:**
  - `realtimeOrigins.test.ts`: the fixture now builds a real live tenant.
  - `domain.controller.test.ts`: a generated hostname contained an underscore, which is now
    correctly invalid.

## Testing

| Check | Result |
|---|---|
| **Edge end-to-end** (`edge-e2e.sh`: real production Compose stack + Pebble), GitHub Actions run 37089816907, Ubuntu 24.04, Docker 28.0.4, Compose 2.38.2 | **81 passed, 0 failed** |
| API full suite (`jest`, 2 workers) | 136 suites, **1736 tests: 1735 passed**. 1 timed out (`posPendingSales`, Jest's 5 s limit) and passed **10/10** alone, so **1736/1736 pass** |
| Phase 86 API suites | `customDomain.service` 30/30, `tlsAskServer` 5/5, `socketOrigin` 12/12, `realtimeOrigins` 6/6, `env` 34/34, `domainVerification` 25/25, `domain.controller` 27/27, `restaurant.controller` 65/65 |
| Admin / storefront / utils unit | 9/9, 22/22, 8/8 |
| TypeScript | API, admin and web: 0 errors |
| Lint (all apps) | exit 0, **0 errors**; warnings unchanged from before this phase (API 11, web 12, admin 19) |
| **Full Playwright suite** (70 specs, 129 tests, local dev servers) | **124 passed, 4 failed, 1 did not run.** Details below. |
| Docker build | api, web, admin, marketing images built by `docker compose build` from the production compose file (edge run) |
| Compose startup | all 6 containers healthy (caddy, api, web, admin, marketing, redis) |

**Playwright failures, investigated:**
- **`legal-pages`:** fails by design until the legal placeholders are filled; the test says so.
- **`menu-rbac` and `phase28 Kitchen/Staff toggles`:** passed when rerun alone. Timing flakes
  under parallel load.
- **`phase28 loyalty reward redemption`:** fails the same way on the **Phase 85B baseline**
  (checked by running it against `19abd51`), so it predates Phase 86. Likely cause: the spec
  registers `waitForResponse` after the navigation it waits for.

**Earlier edge runs** (no application defect in any of them):

| Run | Commit | Result | Cause |
|---|---|---|---|
| 37082455095 | `633b8fa` | 41 / 40 | The DNS test server didn't start (wrong flag), so Pebble couldn't resolve names and no certificate was issued |
| 37087162120 | `657dd57` | 8 / 8, stopped early | Added diagnostics; they showed the DNS test server printing its usage text |
| 37087888501 | `de4ff5c` | 8 / 8, stopped early | Still a wrong flag (`-dns01`); the source shows it's `-dnsserver` |
| 37088876019 | `62c4eaa` | **80 / 1** | Whole lifecycle passed. The 1 failure was my check expecting 200 at the API root, which has no route |
| 37089816907 | `fa77757` | **81 / 0** | Final |

**Edge results by area (final run):**

- **Fixed hostnames:**
  - all 7 served over HTTPS with certificates verified against the test CA;
  - HTTP → HTTPS 308;
  - deep links `order./r/demo-restaurant` and `pos./pos` → 200;
  - `api./health` reports Mongo and Redis up;
  - `/internal/tls/ask` on the public API → 404.
- **Tenant setup:**
  - deploy steps `seed.js` and `provisionProductionDemo.js` work in the container;
  - the owner signs in through `app.`;
  - a Growth trial grants `custom_domains`.
- **Lifecycle:**
  - before adding: ask 403; pending: 403 and no certificate (TLS handshake refused); verified:
    403; active: 200;
  - real TXT verification through DNS succeeds;
  - the admin panel receives `{"servingAvailable":true,"cnameTarget":"domains.garnishtable.example"}`.
- **First visit:**
  - an on-demand certificate is issued by the ACME CA; HTTPS → 200;
  - `by-domain` → `demo-restaurant`;
  - deep links `/`, `/cart`, `/orders/:id`, `/account`, `/login`, `/loyalty` → 200;
  - `/api` and `/sitemap.xml` through the domain → 200;
  - HTTP → HTTPS 308;
  - **browser:** renders "Wildwood Kitchen" and "Margherita Pizza", and `/cart` renders.
- **Persistence:** after a Caddy restart the same certificate serial is served, with no
  re-issuance.
- **Socket.IO:**
  - **from the custom domain:** connects over WebSocket, receives the `order.created` event
    (ORD-1001) for an order placed through the domain, and stays connected for 70 s;
  - **from `order.`:** the same (ORD-1002);
  - **from `https://evil.example`:** rejected on both polling and WebSocket.
- **Unauthorized hostnames:**
  - a verified-only domain and an unknown domain get no certificate (TLS refused);
  - ask returns 403 for `localhost`, `127.0.0.1`, `api.internal`, `bad_host.example`, a platform
    hostname, and the CNAME target;
  - 0 certificates stored for the unknown host; denials are logged;
  - a bare-IP HTTPS request gets no certificate.
- **Exposure:** ports 4000, 4001, 6379 and 27017 are unreachable from the host; only Caddy
  publishes ports.
- **Renewal:**
  - serial `3FE2D382D780CBFC` → `1903995D42C54157` automatically;
  - the ask check was consulted during renewal (allow decisions 4 → 5);
  - still served afterwards.
- **Deactivation:**
  - ask returns 403;
  - `by-domain` → 404;
  - Socket.IO from that origin is rejected after the 60 s cache;
  - renewal was blocked (serial unchanged; Caddy logged 8 renewal errors).
- **Failure behaviour:**
  - storefront down → 502 with an empty body;
  - API down → 502 with an empty body, and the ask check fails closed;
  - the API recovers after restart.
- **Shutdown:** the API exits 0 on stop.

## Security review

| Area | Result |
|---|---|
| Host-header handling | Caddy terminates TLS and proxies; the application never trusts Host for tenancy (the SPA sends the hostname, resolved against the DB). Malformed Host: no content served. |
| Normalization | One normalizer and validator in `@restaurant/validation` for every entry point; uppercase and trailing-dot spellings give the same answer (tested). |
| Issuance authorization | Only `resolveCustomDomain(...).live` → 200; everything else 403/503. Renewal re-asks (verified). |
| Internal authorization | Network isolation: a separate listener and port, not published, not routed by Caddy, and 404 on the public API. No shared secret is needed (Caddy's `ask` can't send credentials) and none can leak into frontend code. |
| Caddy exposure | Only 80/443/443udp. The admin API stays on Caddy's localhost. `Server` header removed. |
| Docker networking / Redis / API | Redis is on an `internal: true` network with a password. API and frontends have no published ports (verified from the host). |
| Secrets | API secrets come only from the gitignored env file. Edge `.env` and harness output are gitignored. No certificates in git. |
| Certificate storage | Persistent `caddy_data` volume; backup and restore documented; private keys inside, so treat backups as secret. |
| Domain takeover | Hostname is unique; a new claim after removal requires new TXT proof (tested). A deactivated mapping keeps the hostname reserved. Ownership changes outside GarnishTable need support to remove the old mapping (documented). |
| Stale / deactivated mappings | No new or renewed certificates; not served; sockets refused (verified). An existing certificate stays valid until expiry; no revocation (documented). |
| Cross-tenant routing | Each hostname resolves only to its own location (tested). |
| Arbitrary-domain abuse | Refused after at most one indexed query; malformed names refused before any DB access; denials logged. |
| SSRF | The ask decision is database-only; no outbound request to the requested host. |
| Malformed hostnames | IPs, IPv6, ports, paths, underscores, internal TLDs and over-long labels are rejected (tested). |

## Production readiness

| Item | Status |
|---|---|
| Caddy in the production Compose architecture | **VERIFIED** (edge run) |
| Fixed GarnishTable hostnames | **VERIFIED** against an ACME test CA |
| `CUSTOM_DOMAIN_CNAME_TARGET` configurable and required | **VERIFIED** (unit + edge) |
| Only authorized domains trigger issuance | **VERIFIED** |
| Automatic TLS issuance | **VERIFIED** with Pebble (same ACME protocol as Let's Encrypt). **PARTIALLY VERIFIED** for the real Let's Encrypt CA: not exercised; rehearse with `ACME_CA` set to Let's Encrypt staging on the real server |
| Automatic renewal (re-asking the API) | **VERIFIED** |
| Certificate state persists across restarts | **VERIFIED** |
| Correct restaurant, API, Socket.IO and deep links on a custom domain | **VERIFIED** |
| Deactivated / unknown domains can't obtain or renew | **VERIFIED** |
| Domain takeover protection | **VERIFIED** (unit) / documented |
| Redis private; secrets outside images and git | **VERIFIED** |
| Controlled failure behaviour | **VERIFIED** (502 with no details; ask fails closed) |
| Real public DNS (CNAME propagation, CAA records) | **UNVERIFIED**: needs the real domain and server |
| Apex domains via A record / CNAME flattening | **UNVERIFIED** (documented as support-assisted, not instructed) |
| Hostinger VPS specifics (firewall, IPv6, ports 80/443 open) | **UNVERIFIED**: no server provisioned |
| Full Playwright suite | **PARTIALLY VERIFIED**: 124/129 pass; the 4 failures are explained above (1 by design, 2 flaky, 1 pre-existing) |

## Acceptance criteria

- [x] Caddy is part of the production Compose architecture
- [x] Fixed hostnames work
- [x] `CUSTOM_DOMAIN_CNAME_TARGET` implemented and configurable (required in production)
- [x] Restaurant domains can point to GarnishTable (CNAME target, catch-all on-demand site)
- [x] Only authorized domains trigger issuance
- [x] TLS issued automatically (ACME test CA)
- [x] Renewal automatic, and re-authorized each time
- [x] Certificate state persists across restarts
- [x] Correct restaurant on custom domains; API works; Socket.IO works; deep links work
- [x] Deactivated domains can't obtain or renew; unknown domains can't obtain certificates
- [x] Takeover risks addressed
- [x] Redis private; secrets outside images and git
- [x] Controlled failure behaviour
- [x] Automated tests cover authorization and security
- [~] Phase 85B verification remains green: the four images build and run healthy in this
      phase's run, but the Phase 85B workflow itself wasn't rerun
- [x] Production documentation complete
- [x] No unnecessary architecture changes: single instance, no Cloudflare, no new tenant model

## Next step

On the real server: point `domains.garnishtable.com` and the seven hostnames at it, set
`ACME_CA` to Let's Encrypt **staging**, and bring the stack up. Then run one real restaurant-style
domain through the lifecycle. Only after that, switch `ACME_CA` to production.
