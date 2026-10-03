# Custom Domains — Edge, TLS and Operations

Phase 86. This is how restaurant-owned domains are served in production: **Caddy** as the edge on
one host, in front of the existing containers (`infrastructure/production/`).

GarnishTable stays the single source of truth. A hostname is live exactly when
`resolveCustomDomain` (`apps/api/src/services/customDomain.service.ts`) says so, and three things
ask that one function:
- the storefront's `GET /api/v1/restaurants/by-domain/:hostname`;
- the TLS edge's certificate check;
- the Socket.IO origin check.

## 1. What a restaurant does

| Step | Who | What happens |
|---|---|---|
| 1. Add domain | Owner, Settings → Domain | Enters e.g. `orders.restaurant.com`. It's normalized (case, scheme, trailing dot) and validated: no IPs, ports, paths, underscores, or internal names such as `.local`/`.internal`/`.localhost`, nothing under any GarnishTable hostname, one owner per hostname. A `pending_verification` mapping is created with a fresh random token. |
| 2. Prove ownership | Restaurant's DNS | Adds `TXT _garnishtable-verify.orders.restaurant.com = <token>`. |
| 3. Verify | Owner clicks "Check verification" | The API does a live DNS TXT lookup (`DNS_VERIFIER=node`). On a match: `verified`. |
| 4. Point traffic | Restaurant's DNS | Adds `CNAME orders.restaurant.com → <CUSTOM_DOMAIN_CNAME_TARGET>`. The panel shows the exact record once verified. |
| 5. Activate | Owner clicks "Activate" | `active`. At most one active domain per location. |
| 6. First visit | Any customer | Caddy gets a request for the new hostname, asks the API, and gets "allowed". It obtains a certificate from Let's Encrypt (HTTP-01 challenge to this host) and serves the storefront, which resolves the restaurant from the hostname. |

These are **separate events**:
- **DNS propagation** of the TXT and CNAME records (minutes to hours, the restaurant's provider's TTLs);
- **verification** (step 3; fails until the TXT record is visible);
- **activation** (step 5);
- **certificate issuance** (on the first HTTPS request after activation, usually seconds; it needs
  the CNAME to already point here, because the CA validates over HTTP);
- **storefront availability** (once all of the above are true).

**Order doesn't matter between steps 4 and 5.** If the CNAME isn't in place yet when activated, the
first visit simply fails until it is, and Caddy retries issuance on later requests.

### DNS model

- **Subdomains (recommended):** `orders.restaurant.com CNAME <CUSTOM_DOMAIN_CNAME_TARGET>`.
  This is the only form the dashboard instructs.
- **`www.restaurant.com`:** a subdomain like any other. It works as a CNAME.
- **Apex (`restaurant.com`):** usually can't take a CNAME. It works technically if the restaurant
  either:
  - uses an `A`/`AAAA` record to the edge's public IP, or
  - uses their DNS provider's CNAME flattening (ALIAS/ANAME) to the target.

  **Not instructed in the UI and not recommended:** an `A` record breaks silently if the server's
  IP ever changes, and there's no way to update every restaurant's DNS at once. Treat apex
  domains as support-assisted.
- **One hostname per mapping.** `www` and the apex are two separate domains to add and verify; at
  most one per location is active at a time.
- **`CUSTOM_DOMAIN_CNAME_TARGET` itself** needs an `A`/`AAAA` record to the edge. Because every
  restaurant CNAMEs to this name (never to an IP), moving servers is one DNS change on our side.

## 2. Where it's configured

| Setting | Where | Notes |
|---|---|---|
| `CUSTOM_DOMAIN_CNAME_TARGET` | server `edge.env` (`/opt/garnishtable/config/edge.env`) | Passed to Caddy (a site that redirects to marketing) and to the API (shown to restaurants). Required in production; validated as a bare public hostname. |
| `CUSTOM_DOMAIN_TLS_ASK_PORT` | same (default `4001`) | The API's private listener for the certificate check. Required in production; must differ from `PORT`; **never published**. |
| `ACME_EMAIL`, `ACME_CA`, `CADDY_RENEW_INTERVAL` | same | CA account contact; the CA directory (Let's Encrypt production by default; use staging for rehearsals); the renewal scan interval. |
| The seven hostnames, `GT_EDGE_SUBNET`, `GT_CADDY_IP` | same | Compose derives every `*_ORIGIN`, `PORTAL_ORIGINS` and `TRUST_PROXY` for the API from these, so the edge and the API can't disagree. |
| API secrets | server `api.env` (`GT_API_ENV_FILE`, mode 600) | `MONGO_URI`, `REDIS_URL`, `JWT_*`, `SMTP_*`, `STORAGE_*`, … |

The template is `infrastructure/production/.env.example`.

## 3. How the edge decides (`on_demand_tls` + ask)

```
TLS handshake for orders.restaurant.com (no certificate yet, or renewal due)
  → Caddy: GET http://api:4001/internal/tls/ask?domain=orders.restaurant.com   (private network)
      → resolveCustomDomain(): valid public hostname? not a GarnishTable hostname? mapping active?
        restaurant active? business entitled to custom_domains?
      ← 200 "ok"   → Caddy obtains / renews the certificate from the CA
      ← 403 / 503  → no certificate; the TLS handshake fails; nothing is served
```

- **Fixed GarnishTable hostnames** have their own site blocks and ordinary certificates. They never
  go through the ask check.
- **Every other hostname** falls into the `https://` catch-all with `tls { on_demand }`, proxied to
  the storefront container. Caddy never decides which restaurant a hostname belongs to; the
  storefront asks the API.
- **Plain HTTP** on a custom domain redirects to HTTPS. ACME HTTP-01 challenges are answered first.

### Obtaining vs. holding vs. serving — what deactivation does

| | After the domain is deactivated or removed |
|---|---|
| Authorization to obtain or renew a certificate | **Revoked immediately.** The ask check answers 403, so Caddy can't get a new certificate or renew the existing one. |
| The certificate Caddy already holds | **Stays valid until it expires** (Let's Encrypt: up to 90 days). Nothing revokes it at the CA; this phase doesn't implement revocation. |
| Application-level serving | **Stops immediately.** `by-domain` answers 404, so the storefront shows "no restaurant" on that hostname. Socket.IO stops accepting the origin within 60 s (cache TTL). Re-activating restores everything. |

## 4. Threat model and abuse protection

| Threat | Mitigation |
|---|---|
| Anyone points a domain at our IP to make us request certificates (CA rate-limit exhaustion, resource use) | Only hostnames that pass the full decision are allowed. Unknown hostnames get 403 after **one indexed lookup**; malformed or internal names are refused before any database access. |
| The ask check reachable from the internet | It runs on a **separate listener** (`CUSTOM_DOMAIN_TLS_ASK_PORT`), not on the public API app. That port isn't published by Compose, and no Caddy site routes to it. `https://api…/internal/tls/ask` is a 404. Caddy's `ask` can't send credentials, so isolation is by network. |
| The ask check used to learn tenant data or change state | Read-only; GET only; the body is just `ok`/`denied`/`unavailable`; no ids, no reasons, no writes. |
| API down or database error during a decision | **Fails closed:** 503, so Caddy issues nothing. Existing certificates keep working until they expire. |
| Host-header tricks (case, trailing dot, ports, IPs, `localhost`, internal TLDs, paths, underscores, oversized names) | One normalizer and validator (`@restaurant/validation`), shared by the dashboard, `by-domain`, the ask check and the socket origin check. |
| Cross-tenant routing | The hostname is unique across all tenants (unique index). Resolution always returns the mapping's own location. |
| **Domain takeover** after a restaurant leaves | A removed mapping is deleted, and any new claim starts at `pending_verification` with a **new random token**. The new claimant must prove control of the domain's DNS before activation. While a mapping exists, nobody else can claim the hostname. **A deactivated (not removed) mapping keeps the hostname reserved for its restaurant.** If a domain changes hands outside GarnishTable, support must remove the old mapping before the new owner can claim it. |
| Spoofed client IPs | Caddy doesn't trust incoming `X-Forwarded-For` and sets it from the connection. The API's `TRUST_PROXY` is the private edge subnet only. |
| Origins | Socket.IO refuses handshakes from any Origin that isn't a GarnishTable surface or a **live** custom domain over https, on both polling and WebSocket (Phase 86 `allowRequest`). |
| Redis / API / database exposure | Only Caddy publishes ports (80, 443, 443/udp). Redis sits on an `internal: true` network with a password. MongoDB is external (Atlas). |
| SSRF via the ask check | The API never connects to the requested hostname: the decision is database-only. Verification does only a DNS TXT lookup on `_garnishtable-verify.<host>`. |

**Let's Encrypt rate limits** (production CA): 50 certificates per registered domain per week,
300 new orders per account per 3 hours, and failed-validation limits. Each restaurant domain is its
own registered domain, so one restaurant can't exhaust another's quota.
- **Your own `garnishtable.com` hostnames share one quota.** Avoid repeatedly wiping `caddy_data`.
- **Rehearse against the staging CA** (`ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory`).

## 5. Operations

- **Deploy or update the stack:** `scripts/deploy.sh sha-<commit>` on the server (Phase 87; images
  are built by CI, never on the server). See `docs/production-deployment-runbook.md`.
- **Apply a Caddyfile change without downtime:**
  `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
  A config error leaves the previous config running; check `docker compose logs caddy`.
- **Roll back:** `scripts/rollback.sh` restores the previous deployment, images and Caddyfile
  together (each deployment's Caddyfile comes from its own commit).
- **Certificate state** lives in the `caddy_data` volume (`/data`: certificates, private keys,
  ACME account) and `caddy_config` (`/config`: autosaved config). It's persistent, so restarts and
  redeploys reuse certificates (verified in the edge test).
  - **Back up `caddy_data`:** `scripts/backup.sh` (daily timer) archives it next to the MongoDB dump.
  - **Restore it** the same way before starting Caddy.
  - **Losing it is recoverable, but costly:** Caddy re-issues everything on demand, which counts
    against CA rate limits.
  - **Treat the archive as secret** (private keys). Never commit it.
  - **Owned by Caddy's container user.** Don't edit it by hand.
- **Renewal** is automatic. Caddy scans every `CADDY_RENEW_INTERVAL` and renews when about a third
  of the lifetime remains. Every renewal of a custom domain re-runs the ask check (verified).
- **Inspecting problems:**
  - `docker compose logs caddy | grep -i "orders.restaurant.com"` shows issuance, renewal and
    challenge errors.
  - `docker compose logs api | grep tls-ask` shows each allow/deny decision with its reason (the
    reason is logged, never returned).
  - To ask the decision by hand:
    `docker compose exec caddy wget -qSO- "http://api:4001/internal/tls/ask?domain=orders.restaurant.com"`
  - Common causes: the CNAME isn't propagated yet (CA validation fails); the domain isn't activated;
    the plan lapsed (`not_entitled`); the restaurant is suspended.
- **Remove or deactivate a domain:** the owner uses the dashboard (Deactivate keeps it reserved;
  Remove frees the hostname). Effects are as in §3.
- **Bootstrap order:** Compose starts Caddy only after the API, and its private ask listener, are
  healthy (the API healthcheck checks both listeners). There's no circular dependency: the API
  never calls Caddy, and Caddy reaches the ask listener directly on the private network.

## 6. Failure behaviour

| Situation | Behaviour |
|---|---|
| Caddy down | Nothing is reachable. Containers restart on their own (`restart: unless-stopped`). |
| API down | `api.` → 502 (empty body). Storefronts load, but API calls fail. New or renewed custom-domain certificates are refused (fail closed); existing ones keep working. |
| Storefront container down | Storefront and custom-domain hosts → 502 (empty body). |
| Redis down | `/health` → 503; logins and refresh fail; jobs pause. The ask check still works (it only needs MongoDB). |
| Unknown / inactive / unverified domain | No certificate, so the TLS handshake fails. No tenant is served. |
| DNS not configured yet | CA validation fails. Caddy logs the error and retries on later requests (with backoff). |
| Certificate issuance failure | That hostname only; every other site is unaffected. |
| Malformed Host header | No certificate (HTTPS), or a redirect with no content served (HTTP). |

## 7. Verification harness

`infrastructure/production/test/edge-e2e.sh` runs the **real** production Compose stack plus a
test-only overlay: Pebble (Let's Encrypt's ACME test CA, issuing 240-second certificates so renewal
happens during the run), its DNS test server, and a throwaway MongoDB. It runs the whole lifecycle
end to end with real DNS TXT verification, real ACME HTTP-01 issuance and renewal, a browser, and
Socket.IO through the edge. Requires Docker. Results from the Phase 86 run are in
`PHASE_86_CUSTOM_DOMAIN_EDGE_TLS_REPORT.md`.
