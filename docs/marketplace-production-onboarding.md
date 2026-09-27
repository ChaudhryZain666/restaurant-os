# Marketplace Provider Production Onboarding

Phase 83 — a single source of truth for exactly what stands between each marketplace
integration's current, engineering-complete state and a real, live connection carrying real
customer orders. Maturity vocabulary used throughout, in increasing order of confidence:

- **ENGINEERING READY** — code is written, typed, tested against mocks, internally consistent, and
  has never made a real network call to the provider.
- **PROVIDER APPROVED** — the external gate (written approval, certification, account access) has
  been granted by the provider, and real credentials exist, but the integration has not yet
  processed a real order.
- **PRODUCTION ACTIVE** — verified against the real provider with at least one real order actually
  ingested end-to-end.

No provider below has ever advanced past **ENGINEERING READY**. `MARKETPLACE_PROVIDER_MODE`
defaults to `mock` everywhere (including production, unless explicitly overridden — see §"Mock
provider safety" below); nothing in this codebase pretends otherwise.

---

## Uber Eats

| | |
|---|---|
| Technical state | ENGINEERING READY — real OAuth `authorization_code` connect flow (`marketplaceProviders/uberEatsConnect.ts`), real webhook HMAC-SHA256 signature verification, real order-ingestion pipeline (`marketplaceOrderIngestion.service.ts`). |
| Capability state | Menu sync, item availability updates, order accept/deny all implemented (`UberEatsProvider.ts`'s declared capabilities). The only provider of the three with a real merchant-facing OAuth connect button in the admin UI. |
| External requirement | Uber's own documentation states API access "may require written approval from Uber." |
| Owner/founder action required | Apply for/obtain Uber Eats developer API access; once granted, obtain `UBER_EATS_CLIENT_ID`, `UBER_EATS_CLIENT_SECRET`, `UBER_EATS_WEBHOOK_SECRET`, and confirm the registered OAuth redirect URI matches `UBER_EATS_REDIRECT_URI` (or the `${ADMIN_ORIGIN}/marketplace/oauth-callback` default). |
| Evidence needed to advance to PROVIDER APPROVED | Uber's own approval confirmation/email or dashboard access showing live API credentials issued. |
| Evidence needed to advance to PRODUCTION ACTIVE | One real order successfully ingested from a real Uber Eats store, end-to-end, with a real accept/deny round-trip inside the real 11.5-minute SLA. |
| Activation condition | Set `MARKETPLACE_PROVIDER_MODE=live` **and** all three `UBER_EATS_*` env vars. The per-provider connect flow itself will still gate correctly even before this — `getMarketplaceProvider` only builds a real adapter when `MARKETPLACE_PROVIDER_MODE=live`, and `buildLiveProvider` throws a clear, specific error if credentials are still missing at that point. |
| Rollback/deactivation | Set `MARKETPLACE_PROVIDER_MODE=mock` (affects all three providers at once — there is no independent per-provider live/mock toggle today) or disconnect the specific integration via the admin UI (`MarketplaceIntegrationsPage.tsx`'s Disconnect action), which does not require touching env vars. |

## DoorDash

| | |
|---|---|
| Technical state | ENGINEERING READY — real JWT-Bearer request signing (`DoorDashProvider.ts`), real webhook JWT re-verification. |
| Capability state | `connect.mechanism: "not_available"` — correctly, honestly shown in the admin UI as "coming soon," no connect button rendered at all (verified directly in `MarketplaceIntegrationsPage.tsx`'s own conditional). |
| External requirement | DoorDash's own onboarding requires a Technical-Account-Manager-assisted certification process — materially higher barrier than Uber Eats or foodpanda, both of which have at least a documented self-serve developer-portal path. |
| Owner/founder action required | Initiate contact with DoorDash's own developer/partnerships team to begin certification; this cannot be self-served from a developer portal alone. |
| Evidence needed to advance to PROVIDER APPROVED | A DoorDash-issued `DOORDASH_DEVELOPER_ID`/`DOORDASH_KEY_ID`/`DOORDASH_SIGNING_SECRET` set, confirmed functional against DoorDash's own sandbox (if one is made available during certification). |
| Evidence needed to advance to PRODUCTION ACTIVE | One real order successfully ingested from a real DoorDash store. |
| Activation condition | Same mechanism as Uber Eats: `MARKETPLACE_PROVIDER_MODE=live` plus all three `DOORDASH_*` env vars. |
| Rollback/deactivation | Same as Uber Eats. |

## foodpanda

| | |
|---|---|
| Technical state | ENGINEERING READY — real `client_credentials` OAuth2 token flow scoped to one `chainID`, real static-token webhook verification (constant-time comparison). |
| Capability state | `connect.mechanism: "platform_admin_managed"` — foodpanda has no individual merchant-facing sign-in step at all; every connection must be completed by GarnishTable's own team on a restaurant's behalf. Correctly shown as unavailable to the restaurant owner directly. |
| External requirement | foodpanda Account Manager access to obtain a `chainID` and client credentials. |
| **A real, disclosed architectural uncertainty** (from `FoodpandaProvider.ts`'s own header comment, not new to this phase): it is genuinely unconfirmed whether foodpanda's Catalog API can *create* new menu structure from scratch via API, versus only syncing status/price/quantity for items foodpanda already has on file (typically seeded through foodpanda's own restaurant-onboarding process). The code already handles this conservatively — `pushMenu` only updates items that already carry a real `externalId`, never attempts an unconfirmed category-creation call. |
| Owner/founder action required | Establish contact with a foodpanda Account Manager; obtain `FOODPANDA_CLIENT_ID`/`FOODPANDA_CLIENT_SECRET`/`FOODPANDA_CHAIN_ID`/`FOODPANDA_WEBHOOK_TOKEN`; **explicitly ask the Account Manager to confirm the Catalog API's actual create-vs-sync-only capability** before assuming full menu sync will work. |
| Evidence needed to advance to PROVIDER APPROVED | Real chain-level credentials issued, and the Catalog API capability question above answered definitively. |
| Evidence needed to advance to PRODUCTION ACTIVE | One real order successfully ingested from a real foodpanda store. |
| Activation condition | Same mechanism as the other two. |
| Rollback/deactivation | Same as the other two. |

---

## Mock provider safety (cross-reference)

Phase 83 added a production safety net for the shared `MARKETPLACE_PROVIDER_MODE` switch
(`marketplaceProviders/index.ts`): if a production deployment is ever left on `mock` (the default),
a loud, specific warning is now logged the first time any marketplace provider is resolved, rather
than silently ingesting fake orders with no operator-visible signal. This does not change the
external approval requirements above — it only ensures a forgotten configuration step is never
silent.

## What this document is not

This is not a request for credentials, and none were fabricated to produce it — every "action
required" row above is EXTERNAL INPUT REQUIRED from the founder or the named provider, not
something engineering can resolve.
