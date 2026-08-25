# Delivery Architecture — Maps, Delivery Address & Delivery Zones (Phases 9–10)

Phase 8 left the platform with only a location *foundation*: a restaurant could store its own
latitude/longitude (manually), a customer could save a text address, and every delivery order
charged a single flat fee — but nothing validated *where* a customer actually was relative to the
restaurant. **Phase 9** closed that gap: delivery eligibility became a real, server-computed,
radius-based check, with the validated address snapshotted onto the order — but every coordinate
in the system was still typed in by hand, since no map/geocoding provider was connected. **Phase
10** connects one: a real, working address-autocomplete and forward-geocoding service, sitting
entirely on top of Phase 9's untouched eligibility/fee/snapshot pipeline.

## What was IMPLEMENTED

**Phase 9:**
- Radius-based delivery eligibility, computed server-side from real coordinates (Haversine
  distance), never trusting a client-supplied distance or fee
- A structured, coordinate-bearing customer delivery address (both saved addresses and the
  per-order snapshot)
- A live "is my address deliverable" checkout preview, backed by the same eligibility logic
  `createOrder` itself enforces
- A real delivery-radius setting in the admin Delivery page, gated behind the restaurant having
  coordinates at all
- Full order-creation validation: delivery enabled → restaurant has coordinates → radius
  configured → customer coordinates present → within range → fee computed

**Phase 10:**
- A real, provider-agnostic `GeocodingService` boundary (`apps/api/src/services/geocoding/`) with
  a genuinely working adapter (LocationIQ — see "Provider decision" below) and a deterministic
  offline adapter (`GEOCODING_PROVIDER=test`) used by this repo's own Jest/Playwright suites
- Forward geocoding (`POST /geocoding/geocode`), address autocomplete
  (`GET /geocoding/autocomplete`), and suggestion resolution (`GET /geocoding/resolve/:id`) — all
  authenticated, rate-limited, and never exposing the provider API key to the browser
- A shared `AddressAutocomplete` search component (one copy per frontend app — see "Provider
  architecture" below) used in three places: the customer's saved addresses (`AccountPage`), the
  delivery checkout address (`CartPage`), and the restaurant's own location
  (`SettingsPage` → Location)
- Address **editing** for saved addresses (`AccountPage` previously only supported add/remove) —
  including a direct path from "this address has no coordinates" to searching and adding them
- Server-side caching of geocoding/autocomplete results (Redis, short TTLs) and a per-route rate
  limiter, protecting real provider quota/cost
- Coordinates are never invented from arbitrary typed text — they only ever come from resolving an
  actual provider suggestion (or the one-shot `geocode` lookup), consistent with Part 6/9's
  explicit requirement

## What is explicitly NOT implemented (future / provider-dependent)

- **Phase 28 update — embedded map now built.** A real, pin-showing map (Leaflet + OpenStreetMap
  tiles, no API key/billing account — `apps/admin/src/components/MapPreview.tsx`) replaced the
  external "Preview on a map ↗" Google Maps link in Settings, and now also renders a live
  delivery-radius circle on the Delivery page. Still view-only: the geocoding/`AddressAutocomplete`
  flow below remains the only way to CHANGE a location's coordinates — no new geocoding path.
- **No driving/routing distance, no ETA.** Distance is still straight-line (Haversine) only — see
  Phase 9's "Distance calculation" section; geocoding resolves a *point*, not a route.
  Chosen as the real provider (see below), but **this environment has no real LocationIQ API key**
  — `GEOCODING_PROVIDER=test` is configured instead, a genuinely-implemented, deterministic
  adapter, not a stub. Setting `GEOCODING_PROVIDER=locationiq` + `GEOCODING_API_KEY` is a
  configuration change only; no code changes are needed to go live with real geocoding.
- **Phase 28 update — distance-tiered pricing now built.** `Restaurant.settings.deliveryFeeTiers`
  (optional, `{maxDistanceKm, fee}[]`) lets an owner configure a fee that varies by distance instead
  of one flat rate; `delivery.service.ts` picks the tightest-fitting bracket that still covers the
  order's actual `distanceKm` (already computed, previously unused for pricing), falling back to the
  flat `deliveryFee` when unset — fully backward compatible. Polygon/explicit delivery zones remain
  out of scope, unchanged from Phase 9.
- Driver accounts, dispatch, live GPS tracking, route optimization, multi-location, billing,
  custom domains, white-label, WhatsApp, AI, public API, POS/printer integration — all explicitly
  out of scope, unaffected by either phase.

## Provider decision

Three real, production-usable geocoding/autocomplete providers were compared before choosing one
(Part 2's explicit "don't assume Google Maps simply because it's familiar"):

| | Google Maps Platform | Mapbox | **LocationIQ (chosen)** |
|---|---|---|---|
| Forward geocoding + autocomplete | Yes (separate Places Autocomplete + Geocoding APIs) | Yes | Yes (`/search` + `/autocomplete`, both return coordinates directly) |
| Free-tier signup | Requires a billing account/credit card | Requires a billing account for most tiers | **No card required** for the free tier (5,000 req/day) |
| Caching policy | Restrictive — ToS limits how long geocoding results may be cached and, for some endpoints, requires results to be shown on a Google Map | Permissive for short-term caching | **Explicitly permissive** — a real fit for Part 12's caching requirement |
| International / Pakistan coverage | Excellent | Good | Good (OpenStreetMap-based; strong in major urban areas) |
| Server-side integration | Yes | Yes | Yes — plain REST, no client SDK required |

LocationIQ won on the combination that mattered most for a bootstrapped multi-tenant SaaS: real
autocomplete + geocoding, a free tier reachable without a credit card, and — critically — a
caching policy that doesn't fight Part 12's explicit ask to cache results. Google's restrictive
caching terms and mandatory-map-display conditions made it a worse fit here despite its raw
coverage advantage; Mapbox was the closest runner-up.

**The application never talks to LocationIQ directly.** Every call goes through
`GeocodingService` (`apps/api/src/services/geocoding/types.ts`) → `LocationIqProvider` (the
adapter). Swapping providers later means writing one new adapter class against the same interface
and changing `GEOCODING_PROVIDER` — no controller, no React component, no other model ever
mentions LocationIQ by name.

## Provider architecture

```
apps/api/src/services/geocoding/
  types.ts                 GeocodingService interface, GeocodeResult/AddressSuggestion re-exports,
                            GeocodingError + its typed error codes
  LocationIqProvider.ts     the real adapter — the ONLY file that knows LocationIQ's response shape
  TestGeocodingProvider.ts  deterministic, offline adapter (see "Testing" below)
  index.ts                 getGeocodingService() — lazy singleton, mirrors email/index.ts and
                            payments/index.ts exactly
```

Provider-specific fields (LocationIQ's `place_id`, `lat`/`lon` as strings, `address.house_number`,
...) are mapped to the normalized `GeocodeResult`/`AddressSuggestion` shapes (`@restaurant/types`)
**inside `LocationIqProvider.ts` only** — no controller, Order model, Address model, or React
component ever sees a raw provider field name (Part 11).

`getGeocodingService()` never throws at boot (Part 3) — only when a route actually calls it
without `GEOCODING_PROVIDER` set:

```ts
export function getGeocodingService(): GeocodingService {
  if (env.GEOCODING_PROVIDER === "locationiq") { /* requires GEOCODING_API_KEY, throws clearly if absent */ }
  if (env.GEOCODING_PROVIDER === "test") { /* deterministic, no network */ }
  throw new Error("Geocoding is not configured. Set GEOCODING_PROVIDER=locationiq (...) or GEOCODING_PROVIDER=test.");
}
```

This is the exact same lazy-singleton shape as `email/index.ts`'s `getEmailService()` and
`payments/index.ts`'s `getPaymentProvider()` — a deliberate, established pattern in this codebase
for "a real capability that may not be configured everywhere."

**Frontend**: two near-identical copies of an `AddressAutocomplete` component exist
(`apps/web/src/components/AddressAutocomplete.tsx`, `apps/admin/src/components/AddressAutocomplete.tsx`)
rather than one shared package export. `apps/web` and `apps/admin` are independent Vite apps with
their own `apiClient` instances and each has multiple/one real consumer respectively; extracting a
cross-app shared component for this would need to abstract over two different API clients and
styling conventions for no real reuse benefit yet (`@restaurant/ui` is this monorepo's actual
shared-component boundary, and neither app's usage here needed anything from it that a plain
`input` + dropdown didn't already provide).

## Geocoding endpoints

All three require authentication (any logged-in user — this is generic address-lookup capability,
not restaurant-scoped data, same reasoning as `promotion.routes.ts`'s `/check` endpoint) and share
a 30-requests/60-seconds rate limiter, separate from the app-wide and `/auth` limiters:

- **`GET /geocoding/autocomplete?q=...`** — returns `{ suggestions: [{ id, label }] }`. Empty
  array (not an error) for a query under 3 characters or with zero matches.
- **`GET /geocoding/resolve/:suggestionId`** — returns `{ result: GeocodeResult }` for a
  previously-issued suggestion id. This is what actually produces coordinates — the id alone
  carries no location data the client could fabricate.
- **`POST /geocoding/geocode`** — one-shot forward geocode of a complete address string, `{
  result: GeocodeResult }`. Used for the "type a full address, no dropdown" case (this phase's
  Jest integration tests use it this way for a deterministic assertion), and available to any UI
  that wants a single-shot lookup instead of the autocomplete flow.

## Autocomplete → resolve flow (Part 4/6)

```
customer types              →  GET /geocoding/autocomplete (debounced 400ms, frontend)
suggestion list shown       →  customer clicks one
                             →  GET /geocoding/resolve/:id
                             →  { formattedAddress, latitude, longitude, components }
form fields auto-filled     →  customer can still fine-tune line1/apt/city before saving
```

LocationIQ's `/autocomplete` response already includes coordinates per suggestion (unlike
providers that split "autocomplete" and "place details" into two real HTTP calls) — so
`resolveSuggestion()` is served out of the same Redis cache `autocomplete()` populated, with zero
extra provider round-trips. The `GeocodingService` interface still models a genuine two-step flow
(a provider that *does* need a second call would implement `resolveSuggestion()` by making one),
so this is a real abstraction, not one narrowed to fit LocationIQ's shortcut.

**Coordinates are never invented from typed text.** `applyGeocodeResult()` in every consuming form
(`AccountPage`, `CartPage`, admin `SettingsPage`) only ever runs on a `GeocodeResult` object that
came back from `/geocoding/resolve` or `/geocoding/geocode` — there is no code path that takes
whatever a customer typed into the address fields and treats it as coordinates.

## Address lifecycle (Part 7)

`AccountPage` previously only supported add/remove for saved addresses. This phase adds **edit**
(the backend `PATCH /users/me/addresses/:id` endpoint already existed and needed no changes):

- **New address**: search → pick a suggestion → structured fields + coordinates auto-fill →
  customer can still hand-edit line1/apt before saving → Save.
- **Legacy address with no coordinates** (pre-existing data, or one saved via the manual fallback):
  stays fully valid — visible, usable for pickup/dine-in display, reusable. The address row shows
  a direct "No coordinates — set location for delivery" affordance that opens the same
  search-driven edit form, pre-filled with the existing address, so adding a location later is a
  single click into a familiar flow, not a dead end.
- **Manual coordinate entry remains available**, behind an explicit "Enter coordinates manually
  instead" toggle in every consuming form (Part 8's "can remain as an administrative fallback") —
  for when a real address genuinely isn't in the provider's index, or `GeocodingService` itself is
  unconfigured (see "Provider failure behavior" below).

`CartPage`'s checkout flow follows the same shape: the saved-address dropdown (unchanged from
Phase 9) sits alongside the new search box — picking either one populates the same
`deliveryDraft` state, and selecting a fresh search result resets the dropdown to "a new,
unsaved address" so the two selection paths can never silently disagree about what's selected.
Whichever path is used, the **same Phase 9 debounced `POST /restaurants/:id/delivery/check` call**
still runs before "Delivery available" is ever shown, and `createOrder` still re-validates from
scratch — the frontend's eligibility preview is UX only, never the security boundary (unchanged
from Phase 9).

## Provider failure behavior (Part 5)

| Provider outcome | `GeocodingErrorCode` | Customer sees |
|---|---|---|
| No `GEOCODING_PROVIDER` configured | `not_configured` | "Address lookup isn't available right now." |
| Query under 3 characters | `invalid_input` | "Enter at least 3 characters to search." |
| No matching address | `no_results` | "No matching address was found." |
| Provider rate-limited us | `rate_limited` | "Too many address lookups right now — please wait a moment and try again." |
| Timeout / network failure / malformed response / invalid credentials | `timeout` / `provider_error` / `provider_error` / `not_configured` | "Unable to find that address right now. Please try again." |

Every code path is logged server-side with its real code and message
(`console.error("[geocoding] ...")`); the client only ever receives one of the fixed strings above
— never a raw provider exception, stack trace, or the API key (verified by a Jest test asserting
the response body never contains the key string, and by construction: `LocationIqProvider` never
puts `this.apiKey` into anything it returns or throws). If the whole feature is unconfigured, every
consuming form degrades to its manual-coordinate fallback rather than becoming unusable — checkout
and address-saving still work exactly as they did in Phase 9.

## Caching (Part 12)

Two Redis-backed caches, both inside `LocationIqProvider` only (not a generic cross-cutting cache
layer — Part 12's "don't introduce caching complexity if it isn't justified"):

- **Autocomplete suggestion cache** (`geocoding:suggestion:<placeId>`, 10-minute TTL) — populated
  by every `autocomplete()` call, consumed by `resolveSuggestion()`. This is what avoids a second
  provider round-trip when a customer picks a suggestion they just saw. 10 minutes comfortably
  covers "search, glance at the list, click one"; an expired id just means "please search again,"
  never a silently wrong location.
- **Geocode result cache** (`geocoding:geocode:<normalized query>`, 24-hour TTL) — the same address
  string geocoded twice gets the same answer; this avoids paying for/rate-limiting on repeat
  lookups of a popular address (e.g. a well-known local landmark typed by several different
  customers).

Both are **performance/cost caches, not a data store**: keyed only by the query text/place id, with
no `customerId`/`orderId`/`userId` attached, and both expire on their own via Redis TTL. A
customer's actual saved address is never read from this cache — it lives solely in
`User.addresses`, exactly as in Phase 9. This also means the cache can't accumulate "arbitrary
private customer addresses indefinitely" (Part 12's explicit concern): worst case, it holds an
anonymous, soon-to-expire address-text → coordinates mapping indistinguishable from what the
provider would return to anyone else searching the same text.

## Rate limiting (Part 13)

- **Backend**: a dedicated `express-rate-limit` instance on the whole `/geocoding` router — 30
  requests per 60 seconds per IP, tighter than the app-wide limiter and separate from `/auth`'s.
- **Frontend**: `AddressAutocomplete` debounces 400ms after the last keystroke before calling
  `/geocoding/autocomplete` at all, and guards against a slower, now-stale response overwriting a
  newer one (an incrementing request-id ref, checked before applying any response to state) — the
  practical equivalent of request cancellation without needing to thread an `AbortSignal` through
  the shared `apiClient` package used by both frontend apps.
- **Validation**: every query is capped at 200 characters (`packages/validation/src/geocoding.ts`)
  before it ever reaches a provider call.

## Privacy & security (Part 14)

- The LocationIQ API key lives only in `apps/api/.env` (`GEOCODING_API_KEY`), read server-side by
  `LocationIqProvider`; it is never sent to, stored in, or reachable from either frontend app —
  there is no "public/browser-safe key" mode for this provider, so none was added.
- No full customer address is logged — `console.error("[geocoding] ...")` only ever logs the
  `GeocodingError`'s code/message, never the query text or the resolved address.
- **Tenant isolation is unaffected by this phase.** Geocoding produces coordinates; Phase 9's
  `checkDeliveryEligibility` still resolves the restaurant exclusively from the trusted URL param
  and reads only *that* restaurant's own `latitude`/`longitude`/`settings` — a geocoded coordinate
  is just a different source for the same `latitude`/`longitude` numbers `checkDeliveryEligibility`
  already treated as pure input. A new integration test (`geocoding.controller.test.ts`) proves
  this explicitly: the same geocoded coordinates are checked against two restaurants with
  different locations/radii/fees, and each restaurant's own configuration — never the other's — is
  what comes back.

## Map / radius visualization — built in Phase 28

Originally skipped in Phase 9/10: LocationIQ's core API is geocoding/autocomplete only, and an
interactive map needs a *separate* capability (tile rendering) with its own dependency footprint,
so this phase's "preview on Google Maps ↗" external link served honestly at zero added cost instead.
Phase 28 added that separate capability deliberately: Leaflet + OpenStreetMap tiles (still free, no
API key/billing account, so the original cost reasoning stays satisfied) via
`apps/admin/src/components/MapPreview.tsx`, embedded in both Settings (restaurant location) and
Delivery (with a live radius circle). This is purely a rendering layer over coordinates the
geocoding flow already produces — it doesn't change how a coordinate is resolved or validated.

## Testing (Part 20/21)

`GEOCODING_PROVIDER=test` selects `TestGeocodingProvider` — a real, selectable adapter (not a test
double that bypasses `GeocodingService`) with a small fixed fixture set (Springfield/Chicago/
Austin/Boston, matching Phase 9's existing eligibility-boundary test coordinates exactly) and a
documented magic trigger string (`"provider_error_test"`) for exercising the failure path on
demand. Both the Jest suite and the Playwright suite run against this adapter — **neither depends
on live network access to LocationIQ**, satisfying Part 21's explicit requirement, while
`LocationIqProvider` itself is still fully unit-tested against a mocked `fetch` (valid response,
empty results, malformed JSON, 401/429/404, network failure, timeout, and that the real cache
avoids a second call).

New this phase: `LocationIqProvider.test.ts`, `TestGeocodingProvider.test.ts`,
`geocoding.controller.test.ts` (endpoint behavior, and integration tests that resolve a real
geocoded coordinate through the **unmodified** Phase 9 `/delivery/check` and `createOrder` paths —
no mocking away Haversine or eligibility), new cases in `account.controller.test.ts` (legacy
addresses without coordinates, coordinate persistence, editing to add a location later), and
`e2e/geocoding-delivery.spec.ts` (full search→select→order flow, no-results, simulated provider
failure, outside-radius, online payment amount correctness, promotion + delivery, cross-restaurant
isolation, mobile viewport, and a pickup/dine-in regression check).

## Future provider replacement strategy

Swapping LocationIQ for a different real provider (or adding a second one, e.g. for a region where
LocationIQ's OSM-based data is weaker) means: write a new class implementing `GeocodingService`
(`apps/api/src/services/geocoding/types.ts`), map that provider's response shape to
`GeocodeResult`/`AddressSuggestion` entirely inside the new adapter file, and add a branch in
`getGeocodingService()` (`index.ts`) for a new `GEOCODING_PROVIDER` value. No controller, route,
React component, or model changes are needed — that's the entire point of the boundary.

---

*(Phase 9 content below is unchanged except for the two sections rewritten above — "Map
architecture" and "Geocoding / provider architecture" — and small cross-references.)*

## Restaurant location architecture

`Restaurant.latitude` / `Restaurant.longitude` (existed since Phase 4/5) — the point delivery
radius is measured *from*. Now populated either by the admin's geocoding search (Phase 10) or
still by hand (the manual fallback). If a restaurant has no coordinates set, delivery eligibility
simply can't be computed (`checkDeliveryEligibility` returns `{ eligible: false, reason:
"...hasn't set up its location for delivery yet" }`) rather than silently defaulting to "unlimited
range" or "always eligible."

## Delivery settings

Extended, not duplicated. `Restaurant.settings` already had `deliveryEnabled` and `deliveryFee`
(Phase 1) — both reused completely unchanged. The one new field (Phase 9) is
`settings.deliveryRadiusKm?: number` (optional; `undefined` means "not configured," distinct from
`0`).

## Delivery zone architecture

**Radius-based, not polygon/explicit zones** — a single number (km) plus the restaurant's own
coordinate is sufficient to answer "can we deliver here," with no map-drawing UI, no GeoJSON
storage, no spatial index required. A polygon/GIS system would need a real map-drawing provider,
`2dsphere` geospatial indexes, and materially more UI — none of which either phase's scope
justified.

## Distance calculation

`apps/api/src/services/delivery.service.ts`'s `haversineDistanceKm()` — the standard great-circle
distance formula, pure and synchronous, no external calls. Straight-line, not driving/routing
distance — a real routing distance would need a *separate* routing/traffic provider (Google
Directions, Mapbox Directions, OSRM...), a different integration from the geocoding this phase
adds. Straight-line distance is a reasonable, honest approximation for a *radius eligibility*
check, not a precise ETA.

**Validation before any distance math runs** (`checkDeliveryEligibility`):
1. `settings.deliveryEnabled` must be true
2. the restaurant must have both `latitude` and `longitude`
3. `settings.deliveryRadiusKm` must be configured
4. only then is `haversineDistanceKm` computed against the customer's coordinates

Each failure returns a specific, customer-facing `reason`, and the computed distance is rounded to
2 decimal places for display. A coordinate exactly on the radius boundary is eligible
(`distanceKm > radiusKm` is the rejection condition, not `>=`).

## Order delivery snapshot

`Order.deliveryAddress: { line1, line2?, city, state?, postalCode?, country?, latitude, longitude, instructions? }`
and `Order.deliveryDistanceKm: number` — copied at order-creation time regardless of whether the
coordinates came from geocoding or manual entry; a customer later editing/deleting their saved
`Address`, or the restaurant later moving its coordinates, never changes how a past order reads.

## Delivery fee architecture

`settings.deliveryFee` (Phase 1, a flat per-restaurant rate) remains the fallback fee. Phase 28
added an optional `settings.deliveryFeeTiers: {maxDistanceKm, fee}[]` — `checkDeliveryEligibility`
resolves the tightest-fitting tier covering the order's actual distance (falling back to the flat
fee when unset or no tier matches), so every existing restaurant that never configures tiers keeps
behaving exactly as before. `createOrder` only ever applies the fee after `checkDeliveryEligibility`
confirms the address is actually in range; the fee amount itself is always server-read, never
client-supplied.

## Checkout changes

`CartPage`'s delivery section (Phase 9's structured fields + eligibility banner, Phase 10's search
box on top) debounces a live `POST /restaurants/:id/delivery/check` as an address is selected. The
result renders as one of: "Delivery available — Xkm away · $Y.YY delivery fee" (success, green),
"Outside the delivery area" / restaurant-specific reason (warning, amber), or "Checking delivery
availability…" while in flight. **Place order** is disabled for delivery orders until eligibility
comes back positive — a UX guard, not the security boundary. Pickup and dine-in checkout are
completely unchanged by both phases.

## Admin changes

- `DeliveryPage`: delivery radius field (disabled with an explanatory banner until the restaurant
  has coordinates) — unchanged this phase.
- `SettingsPage` → Location: address search (Phase 10) populates the structured address fields and
  coordinates; manual entry remains as an explicit fallback toggle.
- `OrdersManagementPage`: delivery orders show the formatted structured address, distance, and any
  delivery instructions.
- All reuse `restaurant.settings.manage`-equivalent RBAC already in place — no new permission was
  needed anywhere in either phase.

## KDS changes

`KitchenPage` shows a "Delivery · {city}" badge (mirroring the existing "Dine-in · {table}" badge)
— deliberately minimal, no full address, no map, no driver-assignment UI.

## Customer order tracking changes

`OrderDetailPage` renders the structured delivery address, the snapshotted distance, and delivery
instructions (when present). No new real-time system — this still rides Phase 6's existing
Socket.IO "something changed, re-fetch" pipeline unchanged.

## Payment integration

Fully reused (Phase 5), unchanged by either phase. The delivery fee is folded into
`subtotal`/`taxAmount`/`total` inside the same `createOrder` transaction that validates delivery
eligibility; a `Payment` is always created from the order's already-final, server-computed `total`.

## Promotion integration

Fully reused (Phase 5), unchanged by either phase. Promo discount is computed against `subtotal`
before delivery fee is added (`taxableAmount = subtotal - loyaltyDiscount - promoDiscount`, then
`total = taxableAmount + taxAmount + deliveryFee`). Delivery fee is not itself discountable.

## Tenant isolation / security

Every delivery code path resolves its restaurant from the trusted URL/route context — never from
anything client-supplied:

- `POST /restaurants/:restaurantId/delivery/check` and `createOrder`'s delivery branch both load
  `Restaurant.findOne({ _id: restaurantId, status: "active" })` from the URL param, then read
  *that* restaurant's own `latitude`/`longitude`/`settings`.
- The client's only contribution to a delivery check/order is *which coordinates it's asking
  about* (Phase 10: resolved via geocoding, or still typed manually) — never the distance, never
  eligibility, never the fee.
- There is no field in `checkDeliverySchema`, `createOrderSchema`'s `deliveryAddress`, or the new
  geocoding schemas for a restaurant identifier at all; the restaurant is 100% determined by the
  URL path, resolved fresh from the database.

## Database / index changes

**None, either phase.** `deliveryRadiusKm` and the delivery-address subdocument fields (Phase 9)
are plain schema additions with no new indexes. Phase 10 added no new MongoDB fields or indexes at
all — geocoding results live only in Redis (with TTLs, see "Caching" above), never in MongoDB.

## Demo-data changes

All three demo restaurants have real city coordinates and a configured delivery radius:

| Restaurant | City | Coordinates | Delivery radius |
|---|---|---|---|
| demo-restaurant | Springfield, IL | 39.7817, -89.6501 | 8km |
| spice-route | Austin, TX | 30.2672, -97.7431 | 6km |
| bella-vista | Boston, MA | 42.3601, -71.0589 | 5km |

Jordan Lee (demo customer) has a saved, geocoded address ~1.77km from demo-restaurant (well within
its 8km radius) — a ready-to-use "inside the delivery area" address. Priya Patel (demo customer)
has a saved address with **no coordinates** — a ready-to-use example of Phase 10's "legacy address,
search to add a location" edit flow.
