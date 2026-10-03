# Custom Domains — Infrastructure Contract

Phase 85A. Restaurants on Growth and Agency plans (entitlement `custom_domains`) can connect their
own domain, e.g. `orders.somerestaurant.com`, to their storefront. This document separates what the
code already does from what the production edge must provide before a custom domain can actually
serve customers.

**Status (Phase 86): implemented.** The production edge is Caddy (`infrastructure/production/`):
on-demand TLS gated by the API's private certificate-issuance check, routing to the storefront, and
`CUSTOM_DOMAIN_CNAME_TARGET` (required in production). Operations, DNS model and threat model are in
`docs/custom-domains-operations.md`. The contract below is unchanged; Phase 86 is one implementation
of it.

The admin panel's honest "not serving traffic yet" state still applies to any deployment without
`CUSTOM_DOMAIN_CNAME_TARGET`, e.g. development.

These are separate from GarnishTable's own hostnames (`docs/production-architecture.md`), which are
static configuration. Custom domains are tenant data in `DomainMapping`.

## 1. Lifecycle (implemented)

| Step | What happens | Code |
|---|---|---|
| Add | Owner enters a hostname. It's normalised and validated. Any GarnishTable hostname, or anything under one (every `*.garnishtable.com`), is refused. Requires the `custom_domains` entitlement. | `domain.controller.ts` `addDomain`, `isSelfClaim`, `platformHostnames` |
| Verify | Owner publishes a TXT record at `_garnishtable-verify.<hostname>` with the generated token. "Check verification" does a live DNS lookup. | `domainVerification.service.ts`; `DNS_VERIFIER=node` in production (`mock` approves everything) |
| Activate | A verified domain can be activated. At most one active domain per location (unique partial index). | `domain.controller.ts` `activateDomain` |
| Resolve | The storefront on an unknown hostname calls `GET /api/v1/restaurants/by-domain/:hostname`. Returns the restaurant only if the mapping is `active`, the restaurant is `active`, and the business still holds `custom_domains`. | `restaurant.controller.ts` `getRestaurantByDomain`; `apps/web` `RestaurantContext` |
| Canonical / SEO | An active domain becomes the restaurant's canonical URL and its sitemap entry. "Powered by" branding is hidden only when the storefront was reached through the domain. | `sitemap.routes.ts`, `useStorefrontSeo.ts`, `Layout.tsx` |
| Realtime | Socket.IO accepts an `https://` origin whose hostname is an active custom domain, cached for 60s. | `realtime/realtimeOrigins.ts` |
| Plan lapse | The mapping is kept but stops resolving (404) until the entitlement returns. The admin panel says so. | `getRestaurantByDomain`, `DomainSettingsPanel.tsx` |

## 2. What the edge must provide (not implemented: infrastructure)

### 2.1 DNS target

Pick one stable hostname that the edge answers for, e.g. `domains.garnishtable.com`, and set
`CUSTOM_DOMAIN_CNAME_TARGET` to it. The admin panel then shows owners the exact record to add:

```
<their hostname>   CNAME   domains.garnishtable.com
```

Subdomains only. Most DNS providers can't CNAME a bare apex domain, and the panel says to use
something like `orders.yourrestaurant.com`. Supporting apex domains would need either A/AAAA
records to static edge IPs or provider-side CNAME flattening; this isn't designed yet.

### 2.2 Routing

Every request whose `Host` is a customer hostname must be served by the **storefront** build
(`apps/web`), exactly like `order.garnishtable.com`:

- `/api/*` is forwarded to the API. The storefront calls the API at the relative path `/api/v1`, so
  this is required: without it, ordering, login and the domain lookup itself fail.
- `/sitemap.xml` is forwarded to the API.
- Everything else gets static files with an `index.html` fallback.
- The original `Host` header is preserved, because the storefront resolves the restaurant from
  `window.location.hostname`.

`infrastructure/docker/nginx/frontend.conf.template` already answers any hostname
(`server_name _`), so the storefront container needs no change. The edge in front of it must send
customer hostnames to that container.

### 2.3 TLS

Each customer hostname needs its own certificate, issued on demand.

- **Issue only for hostnames that are live custom domains.** The edge asks the platform before
  issuing or renewing: `GET /internal/tls/ask?domain=<host>` on the API's private listener
  (`CUSTOM_DOMAIN_TLS_ASK_PORT`, Phase 86), backed by the same decision as `by-domain`. Any non-2xx
  means no certificate.
- Renew automatically, and stop renewing when a domain is deactivated or removed.
- Redirect HTTP to HTTPS. Socket.IO only accepts `https://` custom-domain origins.

### 2.4 API and cookies

- The refresh-token cookie is host-only and path-scoped to `/api/v1/auth`. On a custom domain it's
  set by the API response that the `/api` proxy relays, so it belongs to that custom hostname.
  Customers signed in on `order.garnishtable.com` are not signed in on a restaurant's own domain,
  and vice versa.
- HTTP CORS doesn't need custom domains, because `/api` is same-origin through the proxy.
- `TRUST_PROXY` must cover the same proxy chain for custom-domain traffic as for platform traffic.

## 3. Security considerations

- **Ownership.** DNS TXT verification (`DNS_VERIFIER=node`) proves control of the hostname. The mock
  verifier must never run in production: it approves every domain.
- **Platform hostnames can't be claimed**, including pending claims. All of `*.garnishtable.com` is
  rejected (`isSelfClaim` against `platformHostnames`).
- **One hostname, one tenant.** `hostname` is unique across all mappings.
- **Dangling DNS.** If an owner removes a domain but leaves the CNAME pointing at the edge, the
  hostname stops resolving (404) and certificate issuance must stop. The edge must not keep serving
  a removed hostname.
- **Realtime origin check** trusts only `active` mappings over https and fails closed when the lookup
  errors. Sockets are still authenticated by token.

## 4. Failure behaviour

| Situation | Result |
|---|---|
| Hostname not mapped, not active, restaurant inactive, or plan lapsed | `by-domain` returns 404 and the storefront shows its not-found state. The platform URL `/r/:slug` keeps working. |
| CNAME added but edge capability not live | The edge has no route or certificate for the host, so browsers get a TLS/connection error. This is why the panel doesn't show the CNAME target until `CUSTOM_DOMAIN_CNAME_TARGET` is set. |
| Certificate issuance fails | The edge serves no certificate for that host. The platform URL is unaffected. |
| `/api` not proxied for the host | The storefront loads but can't fetch the restaurant (lookup fails), so it shows the not-found state. |
| Domain lookup in the Socket.IO origin check errors | That socket connection is refused. Live order updates on that domain stop; the order flow itself still works over HTTP. |

## 5. Turning it on

1. Choose an edge that supports on-demand TLS gated by an "ask" check, and stand it up in front of
   the storefront container for any hostname.
2. Add the issuance check (§2.3). This is the only engineering work left.
3. Create `domains.garnishtable.com` (or similar) pointing at the edge, and set
   `CUSTOM_DOMAIN_CNAME_TARGET` on the API.
4. Confirm `DNS_VERIFIER=node`.
5. End-to-end test with a real domain: add, verify, activate, add the CNAME, wait for the
   certificate, then load the storefront, place an order, and check live order updates.
