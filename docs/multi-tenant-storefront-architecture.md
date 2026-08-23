# Multi-Tenant Storefront Routing & Restaurant Context (Phase 8)

Phase 7 left the customer-facing storefront (`apps/web`) architecturally single-tenant: it
bootstrapped exactly one restaurant, chosen by a build-time env var (`VITE_RESTAURANT_SLUG`), and
every route implicitly meant "this deployment's one restaurant." The backend (`apps/api`) was
already fully multi-tenant — every model, controller, and query was already tenant-scoped by
`restaurantId`. This phase closes that gap on the frontend: the storefront now resolves *which*
restaurant it's showing from the URL itself, and any of this platform's restaurants can be browsed
from the same running deployment.

## What was IMPLEMENTED this phase

- Restaurant-scoped public routing (`/r/:restaurantSlug/...`)
- `RestaurantContext` resolving from the URL slug, not an env var
- Cart isolation between restaurants (conflict detection + explicit clear, never silent merge)
- Table/QR context resolution scoped per-restaurant (fixes a real cross-tenant leak — see below)
- Legacy URL redirects (`/`, `/cart`, `/t/:token`, `/loyalty` → their `/r/:slug/...` equivalents)
- A hardened public restaurant-resolution response (no `ownerId` leak)
- A real, dynamically-generated sitemap covering active restaurants only
- `noindex`/canonical/OG metadata per restaurant page
- Two live secondary demo restaurants (Spice Route, Bella Vista) with their own tables, dine-in,
  and branding, proving genuine multi-tenancy end to end

## What is explicitly NOT implemented (future work)

- **Custom domains.** A restaurant's storefront lives at `/r/:slug` on this platform's one domain
  — there is no mechanism for `order.spice-route.com` to map to a specific restaurant. The
  `/r/:slug` structure is what a custom-domain feature would eventually resolve *to* internally
  (e.g. middleware that maps an incoming `Host` header to a slug and internally routes to
  `/r/:slug`), but no such mapping exists yet.
- **Multi-location.** One `Restaurant` document is still one location. Nothing here introduces a
  parent/location hierarchy.
- **White-label / agency management / platform commissions / SaaS billing.** Untouched.
- A restaurant directory or search UI (how a customer discovers a `/r/:slug` URL in the first
  place — today that's out-of-band: a link, a QR code, a bookmark — not a "browse all
  restaurants" page on this platform).

## Restaurant slug

`Restaurant.slug` already existed (`apps/api/src/models/Restaurant.ts`) — unique, lowercase,
trimmed, indexed — from Phase 0's `by-slug` lookup. **Nothing new was added**; this phase reuses
it as the public routing key rather than introducing a second identifier.

- **Uniqueness**: enforced by a MongoDB unique index; `createRestaurant` additionally pre-checks
  and returns a 409 (`ApiError.conflict`) on a duplicate — unchanged from Phase 0/1.
- **Invalid slug**: `GET /restaurants/by-slug/:slug` 404s (`ApiError.notFound`) for any slug that
  doesn't match an active restaurant. The frontend surfaces this as a "Restaurant not found" page
  (`Layout.tsx`) rather than crashing or falling through to a wrong restaurant.
- **Inactive/suspended restaurant**: the lookup filters `status: "active"` — a `pending` or
  `suspended` restaurant's slug resolves as if it didn't exist (same 404, same "not found" UX).
  This is a deliberate simplification: a customer doesn't need to know a restaurant exists but is
  suspended, only that this link doesn't currently work.
- **Slug change**: **not implemented, and deliberately not exposed anywhere in this phase.** No
  restaurant-settings UI lets an owner edit their slug. This is the right conservative default —
  `/r/:slug` is the public, bookmarkable, QR-encoded, sitemap-indexed identity of a restaurant;
  changing it would break every previously-printed QR code (Phase 7) and every indexed search
  result (this phase) with no redirect mechanism in place to catch the old value. If slug editing
  is ever added, it must ship together with a "previous slugs redirect to current slug" mechanism
  (a small `previousSlugs: string[]` field and a fallback lookup) — building the redirect
  mechanism without the edit feature would be speculative; building the edit feature without the
  redirect mechanism would be a real regression. Documented here instead of built.

## Public restaurant resolution

`GET /restaurants/by-slug/:slug` (unauthenticated, pre-existing route, `apps/api/src/routes/restaurant.routes.ts`)
is the one public resolution endpoint — reused, not duplicated. Its response was tightened this
phase (`restaurant.controller.ts`'s new `toPublicRestaurant()`): every field a customer legitimately
needs to browse and order (name, description, logo, cover image, address/coordinates, phone,
email, `status`, `settings` — pickup/delivery/dine-in availability, tax rate, delivery fee,
business hours, minimum order, brand color) is still returned, but `ownerId` — an internal `User`
reference with no storefront use — is stripped. `Restaurant.ownerId` is now `ownerId?: string` in
`@restaurant/types`, honestly reflecting that it's present only on the authenticated staff-facing
`GET /restaurants/me` response, never on the public one.

No new caching layer was added — `GET /restaurants/by-slug/:slug` is a single indexed lookup
(`slug` has its own index), cheap enough that adding a cache would be premature optimization for
this phase's real load. If per-restaurant traffic ever justifies it, this is the one place to add
a short-TTL cache (Redis, already used elsewhere in this codebase for other purposes) — the lookup
shape (slug → restaurant) is exactly cache-key-shaped already.

## RestaurantContext

`apps/web/src/context/RestaurantContext.tsx` — rewritten, not duplicated. It now resolves via
`useMatch("/r/:restaurantSlug/*")`, mirroring the exact pattern Phase 7's `TableContext` already
established for `/t/:tableToken` (a provider mounted once, above `<Routes>`, that reads whichever
part of the current URL it cares about via `useMatch` rather than needing to be re-mounted per
route). When the slug segment changes — including from one real restaurant to another — the
provider's effect re-fires and replaces `restaurant` state wholesale; there is no stale merge
between two restaurants' data at any point.

`VITE_RESTAURANT_SLUG` still exists but its role changed: it's no longer the storefront's source
of identity, only the target for legacy bare-URL redirects (see below) — exported as
`legacyDefaultSlug()`.

**Every consumer of `useRestaurant()` needed zero changes** — `MenuPage`, `CartPage`,
`LoyaltyPage`, `TableContext`, `CreateTicketPage`, `SupportCenterPage`, and the `promotions/check`
call all already read `restaurant.id` from context rather than computing it themselves. Making the
context URL-driven instead of env-driven was sufficient to make every one of those genuinely
multi-tenant with no further edits — exactly the "migrate onto the context layer, don't rebuild
the features" instruction this phase was scoped to.

## Routing architecture

```
/r/:restaurantSlug                    → MenuPage (storefront landing + menu)
/r/:restaurantSlug/t/:tableToken      → MenuPage (QR dine-in landing — see below)
/r/:restaurantSlug/cart               → CartPage (cart + checkout, same page — matches this
                                          app's existing convention, no separate /checkout route)
/r/:restaurantSlug/loyalty            → LoyaltyPage (auth required)

/                                     → redirects to /r/:legacyDefaultSlug
/cart                                 → redirects to /r/:legacyDefaultSlug/cart
/t/:tableToken                        → redirects to /r/:legacyDefaultSlug/t/:tableToken
/loyalty                              → redirects to /r/:legacyDefaultSlug/loyalty

/login /register /forgot-password /reset-password   → global, account-level
/orders /orders/:id                                 → global, account-level
/account                                             → global, account-level
/support /support/articles/:slug /support/tickets*  → global, platform-level
```

**Why `/orders`, `/account`, and `/support*` stayed global** (deviating from the master prompt's
literal `/r/:slug/orders/:id` example, which it explicitly permits — "choose the cleanest routing
structure rather than blindly copying these exact paths"): a customer's order history is
inherently cross-restaurant (`GET /orders/mine` already returns every order across every
restaurant they've ever ordered from — it was never restaurant-scoped, and making the *URL*
restaurant-scoped while the underlying data isn't would be misleading, not clarifying). Order
*ownership* is enforced independent of URL shape either way — `getOrder`/`cancelOrder` check
`order.customerId === req.user.id`, not anything about the requesting URL — so nesting these
routes under `/r/:slug` would add URL structure with no corresponding security benefit and a real
risk of implying a restaurant-scoping guarantee (only see restaurant A's orders under
`/r/restaurant-a/orders`) that doesn't reflect how the feature actually works. Account settings and
platform support are similarly not tied to any one restaurant's identity.

**Why `/r/:slug/loyalty` (not global)**: unlike orders, `LoyaltyAccount` is genuinely keyed by
`(restaurantId, customerId)` — a customer has a *separate* points balance per restaurant they've
ordered from (see Part 14/loyalty isolation below). Loyalty is restaurant-scoped data, so its URL
correctly is too.

## QR / table-context migration

`table.controller.ts`'s `tableUrl()` (used by `getTableQr`/`regenerateTableQr`) now builds
`${CLIENT_ORIGIN}/r/:restaurantSlug/t/:qrToken` instead of Phase 7's `${CLIENT_ORIGIN}/t/:qrToken`
— the restaurant slug (already public information, visible in the storefront URL a customer is
already browsing) plus the same opaque, secure `qrToken` from Phase 7, completely unchanged in
design. `resolveTable` (`GET /restaurants/:restaurantId/tables/resolve/:token`) is untouched — it
already required and cross-checked `restaurantId`, which the frontend now sources from the
URL-resolved `RestaurantContext` instead of an env var, automatically closing the "single
deployment, single restaurant" assumption without any change to the resolve endpoint itself.

**A real cross-tenant bug was found and fixed while migrating `TableContext`**: its Phase 7
`sessionStorage` persistence stored only the raw token (`dineIn.tableToken`), with no restaurant
association. Once `RestaurantContext` became capable of representing *different* restaurants
within the same browser tab (navigating from `/r/restaurant-a/t/TOKEN` to `/r/restaurant-b`
without a reload), the stored token from Restaurant A would be re-tried against Restaurant B on
every restaurant-context change — harmless in outcome (the resolve call would 404, since
`qrToken` lookups are already restaurant-scoped server-side) but would incorrectly show Restaurant
B's storefront a "this table code isn't valid anymore" error banner the customer never triggered.
Fixed by storing `{restaurantId, token}` pairs and only reusing a stored token when its
`restaurantId` matches the restaurant currently in context; a mismatched/absent stored token is
silently ignored (not surfaced as an error) since no real QR scan happened on that page.

Table token security itself (opaque, random, unrelated to any database ID, never a JWT — see
`docs/qr-dine-in-architecture.md`) is completely unchanged.

## Order creation

`createOrder` (`apps/api/src/controllers/order.controller.ts`) already never trusted a
client-supplied `restaurantId` as authoritative *for pricing or table resolution* — it always
takes `restaurantId` from the URL path (`/restaurants/:restaurantId/orders`) and re-derives
everything else (menu item prices, modifier prices, table identity from `tableToken`, promo
discount) from the database scoped to that same `restaurantId`. This was true before this phase
and needed no change: `priceOrderItems(restaurantId, items)` looks up every `menuItemId` filtered
by that `restaurantId`, so a menu item ID that actually belongs to a different restaurant simply
isn't found — the order fails with a clear error rather than silently pricing against the wrong
menu or letting a Restaurant B item appear on a Restaurant A order. Verified explicitly with a new
test (`order.controller.test.ts`): submitting Restaurant B's menu item ID against Restaurant A's
`createOrder` URL is rejected.

The one place a client-supplied `restaurantId` *could* previously have gone unchecked in spirit —
the frontend now sourcing which restaurant to POST to — is guarded by `CartContext`'s own
isolation (see below): the cart's items always carry the SAME `restaurantId` amongst themselves,
and `CartPage` won't submit at all while a mismatch with the current URL's restaurant is detected.
This is a UX safeguard layered on top of an already-secure backend, not the actual security
boundary — the actual boundary is, and remains, server-side pricing.

## Cart isolation

`CartContext` (`apps/web/src/context/CartContext.tsx`) previously had no restaurant concept at
all — it was safe only because the whole app assumed one restaurant existed. `MenuItem` already
carries its own `restaurantId` (unrelated to this phase — an existing field), so cart isolation
needed no new state: `cartRestaurantId` is derived as `lines[0]?.menuItem.restaurantId ?? null`.

`addItem` now returns `"added" | "conflict"` instead of always mutating — a `"conflict"` means the
cart already holds a different restaurant's items and nothing was added. `MenuPage` surfaces this
as an inline warning ("Your cart has items from a different restaurant. Starting an order here
will clear it.") with an explicit **Clear cart & continue** action — never a silent merge or a
silent overwrite, per Part 10's explicit requirement. `CartPage` carries a second, independent
guard for the case where a customer navigates *directly* to `/r/:otherSlug/cart` with a
mismatched cart already populated (bypassing `MenuPage`'s add-time check entirely): it detects the
mismatch and replaces the normal cart UI with a "Your cart is for a different restaurant" state
plus a **Clear cart** action, blocking checkout until resolved.

Reordering (`OrderDetailPage`'s `reorder()`) now correctly tags the freshly-loaded cart with the
historical order's actual restaurant (`loadFromReorder(items, restaurantId)`, previously a bug
waiting to happen — `restaurantId` was hardcoded to `""` on reorder-populated lines) and navigates
to that restaurant's own `/r/:slug/cart`, not whichever restaurant happens to currently be in the
URL — the reorder API response now includes `restaurantSlug` for exactly this purpose.

## Payment integration

Entirely reused (Phase 5), no changes. `Payment`/`Refund` documents are created from the
already-validated `Order` document's `restaurantId` — never from anything client-supplied
directly — so tenant-scoping was already correct and is unaffected by routing. Verified this
phase's cross-tenant payment test still passes unmodified (pre-existing coverage in
`payment.controller.test.ts`).

## Promotion integration

Entirely reused (Phase 5), no changes. `validatePromoCode(restaurantId, code, subtotal)` was
already restaurant-scoped; a Restaurant B promo code was already rejected against a Restaurant A
order before this phase (pre-existing test, `promotion.controller.test.ts`). Confirmed still
passing.

## Loyalty integration

Entirely reused, no code changes — `LoyaltyAccount`/`LoyaltyTransaction` were already keyed by
`(restaurantId, customerId)` (`getOrCreateAccount(restaurantId, customerId)`), so a customer
ordering from two different restaurants has always naturally gotten two separate point balances.
This phase adds the first explicit **test** proving it (no test previously existed): a customer
who earns points at Restaurant A has a verified-zero, separate balance at Restaurant B.

## Order tracking

`OrderDetailPage`/`OrdersPage` are unchanged (global routes, per the routing-architecture
reasoning above) — `getOrder` already enforces `order.customerId === req.user.id` regardless of
URL, so a customer cannot view another restaurant's — or another customer's — order by editing the
URL, with or without a `/r/:slug` prefix.

## Socket.IO

**No changes — verified, not modified.** Room membership (`apps/api/src/realtime/socket.ts`) was
already derived entirely server-side from the JWT payload at handshake
(`socket.data.restaurantId = payload.restaurantId`, then `socket.join(\`restaurant:${restaurantId}\`)`)
— the browser has never been able to request a socket room; it only ever supplies its access
token (`apps/web/src/lib/socket.ts`'s `createSocketClient(url, getToken)`). This satisfies Part
15's requirement as-is; introducing any restaurant-slug awareness into the socket client would
have been a pure regression risk for zero benefit.

## Multi-restaurant verification

Two live secondary demo restaurants (seeded, not fabricated for a screenshot) prove real
multi-tenancy end to end:

| | demo-restaurant | spice-route | bella-vista |
|---|---|---|---|
| Menu | Pizza, burgers, salads, ... | Butter Chicken, Paneer Tikka, ... | Carbonara, Lasagna, ... |
| Brand color | platform default | `#B91C1C` (red) | `#15803D` (green) |
| Tables + dine-in | 6 tables, enabled | 3 tables, enabled | 3 tables, enabled |
| Orders | own order history | own order history | own order history |

Verified via Jest (menu/table/order/promo/payment/loyalty cross-tenant tests, listed below) and
Playwright (full two-restaurant browse-and-order flow, listed below) that browsing one never
leaks the other's data.

## SEO / canonical strategy

- Each restaurant-scoped `MenuPage` render sets: `<title>`, a meta description, `og:title` /
  `og:description` / `og:type` / `og:image` (when a logo exists), Twitter Card tags
  (`twitter:card`/`title`/`description`/`image`, Phase 12), a `<link rel="canonical">` pointing at
  `${origin}/r/:slug`, and a schema.org **`Restaurant`** JSON-LD block (Phase 12) — `name`,
  `description`, `url`, `image`, `telephone`, `address` (`PostalAddress`, when the restaurant has
  one), `geo` (when it has coordinates), and `hasMenu` (a real `Menu`/`MenuSection`/`MenuItem`
  tree built from the same category/item data the page itself renders — never emitted before the
  menu has actually loaded, never placeholder data). All of it restored/cleaned up on unmount,
  matching the `noindex` tag pattern Phase 7 already established for `/t/:tableToken`.
- The QR landing route (`/r/:slug/t/:token`) explicitly skips the title/description/canonical/
  JSON-LD tags (it's the same `MenuPage` component, `isTableRoute` short-circuits the SEO effect)
  and keeps Phase 7's `noindex, nofollow` meta tag — QR entry points are never indexable.
- **Phase 12:** every private page across `apps/web` (cart, orders + order detail, account,
  login/register, forgot/reset password, confirm-email-change, loyalty, support tickets) now sets
  a real `noindex, nofollow` meta tag via a shared `useNoIndex()` hook
  (`apps/web/src/hooks/useNoIndex.ts`) — not just a `robots.txt` disallow. `robots.txt` only stops
  *crawling*; a disallowed-but-linked URL can still surface in search results with no snippet. The
  meta tag is what actually guarantees non-indexing. `robots.txt` itself was extended to match:
  `/t/`, `/cart`, `/r/*/t/`, `/r/*/cart`, `/r/*/loyalty`, `/orders` (covers `/orders/:id` too —
  disallow rules are prefix matches), `/account`, `/login`, `/register`, `/forgot-password`,
  `/reset-password`, `/confirm-email-change`, `/support/tickets` (covers its `/new` and `/:id`
  children). The only indexable pages remain `/r/:slug` and the public support center/article
  pages.
- No duplicate indexable URLs: legacy bare routes (`/`, `/cart`, `/t/:token`, `/loyalty`) issue a
  client-side redirect (not a second render of the same content), so they're never a second,
  competing indexable URL for the same restaurant.

### Known SEO limitation — not addressed by Phase 12, documented as a next-phase item

All of the above (title, meta, JSON-LD, canonical) is injected **client-side**, after React
mounts and fetches the restaurant/menu data. `apps/web` is a plain Vite SPA with no server-side
rendering or prerendering step. Google's own crawler generally executes JavaScript before
indexing, so this works for Google specifically — but many other crawlers/scrapers (social-media
link-preview bots being the most common real-world case: Slack, Discord, iMessage, older
Facebook/Twitter crawlers) fetch the raw HTML and do **not** execute JavaScript, so they see the
static `index.html` shell with none of this metadata. A shared link to `/r/:slug` posted in Slack
today will not show a rich preview card, even though the JSON-LD/OG tags are technically correct
once a JS-executing crawler renders the page. Fixing this properly requires either (a) SSR/
prerendering (a framework migration — Next.js/Remix-style, or a prerendering layer like
`vite-plugin-ssr`/Prerender.io in front of the existing SPA), or (b) a lighter middle ground: a
tiny edge/reverse-proxy function that detects known bot user-agents and serves them a
server-rendered meta-only snapshot while everyone else gets the existing SPA unchanged. Both are
real architectural changes, not something to bolt on inside the current React components — this
is deliberately left as a documented gap rather than a rushed partial implementation.

## Sitemap

**Newly built — none existed before this phase** (confirmed via `docs/roadmap.md`, which
explicitly lists sitemaps as unbuilt future work). `GET /sitemap.xml`
(`apps/api/src/routes/sitemap.routes.ts`, mounted unprefixed in `app.ts` alongside `/health`) is
generated on request from real data: one `<url>` per `Restaurant` with `status: "active"` AND
`settings.orderingEnabled: true`, pointing at `${CLIENT_ORIGIN}/r/:slug`. No table, cart,
checkout, or order URLs — ever. `apps/web`'s Vite dev proxy forwards `/sitemap.xml` to the API
(alongside the existing `/api` proxy) so it's same-origin with `robots.txt`'s `Sitemap:` line in
dev.

**Deployment note (not implemented, documented as a gap):** in production, `apps/web` is a static
SPA with no server of its own — an equivalent reverse-proxy/rewrite rule (`/sitemap.xml` → the API
origin) needs to exist at the hosting layer, the same way `/api` presumably already needs one.
This phase provides the endpoint and the dev-time proxy; it does not (and cannot, from application
code alone) guarantee a specific production topology has the matching rule.

## Legacy route strategy

Bare Phase-0/Phase-7 URLs (`/`, `/cart`, `/t/:tableToken`, `/loyalty`) are **not** dead — each
issues a `<Navigate replace>` client-side redirect to `/r/:legacyDefaultSlug/...`, where
`legacyDefaultSlug()` is `VITE_RESTAURANT_SLUG`'s current value (unchanged from Phase 0/7, still
defaulting to `"demo-restaurant"`). This specifically preserves the one class of link this
platform cannot remotely update: **physically printed Phase 7 QR codes** already on real tables
encode `/t/:qrToken` — those continue to resolve correctly indefinitely. Bookmarks and any
external links to `/` or `/cart` behave the same way. `replace` (not push) avoids leaving the dead
intermediate URL in browser history.

## Tenant isolation / security summary

Every tenant-isolation guarantee that existed before this phase (menu, orders, payments,
promotions, RBAC, audit log, tables) is backend-enforced independent of URL shape and was not
weakened by adding a new frontend routing layer on top. What changed is *only* how the frontend
decides which restaurant's data to ask for — the backend's answer to "is this actually allowed"
never depended on that decision being correct, only on the authenticated user/tenant match already
in place. The one genuine bug this phase found and fixed (`TableContext`'s unscoped session
storage) was a **frontend UX leak** (a wrong error banner), not a data-access leak — the resolve
endpoint itself was never fooled, since it already validated the token against the URL's
`restaurantId` regardless of what the frontend sent it.

## RBAC / admin separation

Unaffected. `apps/admin` (restaurant admin + platform admin) is a completely separate Vite app on
a separate port/origin from `apps/web` (the customer storefront) — nothing in this phase's routing
changes touches `apps/admin`'s routes, and no public `/r/:slug` URL can reach any admin
functionality; they don't share a router.

## Database / index changes

**None.** `Restaurant.slug`'s unique index already existed. No new fields, no new collections, no
new indexes — this phase is a frontend routing/context migration plus two small backend response
shape changes (`ownerId` removal, `restaurantSlug` addition to reorder) and one new stateless
read-only route (sitemap).

## Demo-data changes

- `spice-route` and `bella-vista` (already existed since Phase 6) now have: `dineInEnabled: true`,
  a distinct `brandColor`, and 3 seeded tables each (idempotent, same guarded-backfill pattern as
  every other step in `seed-demo-data.ts`).
- `demo-restaurant` unchanged (already had 6 tables + dine-in from Phase 7).

## Phase 16 — Multi-Location & White-Label Foundations (documentation only — no code changed)

Phase 16 audited whether the current architecture could evolve toward multi-location and
white-label/custom-domain support without a destructive rewrite. Conclusion for both: the current
single-location, slug-routed model has no active landmine forcing an immediate change, but neither
capability is close — both are real, multi-model migrations, correctly left undone rather than
half-built. Documented here so the eventual work has a starting point instead of a blank page.

### Multi-location — current shape and the blocker

`Restaurant` is still exactly one location: `address`, `city`, `state`, `country`, `latitude`,
`longitude` are flat fields directly on the `Restaurant` document (`apps/api/src/models/Restaurant.ts`),
and `settings` (currency, timezone, tax rate, business hours, delivery radius/fee, payment toggles)
is a single embedded object, not a per-location list. Every operational collection
(`Order`, `MenuItem`, `Category`, `ModifierGroup`, `Table`, `Promotion`, `LoyaltyAccount`, `Payment`,
`Refund`, `AuditLog`) is scoped by a single `restaurantId`, and `User.restaurantId` is a single
`ObjectId` — a staff member scoped to "every location of one brand" isn't representable today.

**Target future model** (not built): `Restaurant` becomes conceptually a **Brand**, gaining a child
`Location` collection — `locationId` referencing `brandId` (today's `Restaurant._id`), each Location
carrying its own address/coordinates and settings *overrides* (falling back to the brand's
defaults where a location doesn't override). Every operational document would need a `locationId`
alongside its existing `restaurantId` (which stays the brand-level tenant boundary — Order/Payment/
Refund/AuditLog isolation logic doesn't need to change, it just gains a second, finer-grained scope
underneath it). `requireTenantMatch` (`apps/api/src/middleware/tenant.ts`) would need a second,
location-level variant layered on top of the existing restaurant-level check, not a replacement of it.

**Why this wasn't attempted now**: it touches the schema of nearly every collection in the system,
changes what "tenant-scoped" means throughout the RBAC/tenant-isolation layer, and no restaurant on
the platform today has a second location to migrate — building it speculatively risks getting the
shape wrong before a real multi-location owner's actual requirements are known (per-location menu
overrides vs. one shared menu? per-location staff vs. shared staff? is a real open product question,
not an engineering one).

**What's already safe and needs no rework later**: nothing assumes one owner per restaurant
(`Restaurant.ownerId` has no unique index); slug-based routing (`/r/:slug`) can grow a location
segment later (`/r/:slug/:locationSlug`) without a breaking change for today's single-location
restaurants, since the bare `/r/:slug` could simply mean "the brand's default/only location."

### White-label / custom domains — current shape and the blocker

Tenant resolution today is either JWT-claim-based (staff/admin — `req.user.restaurantId`, verified
server-side, never trusts the URL) or slug-based (public/customer — `/r/:slug`, see above). No
`Host`-header-based resolution exists anywhere in `apps/api` or `apps/web`.

**Target future model** (not built): a `DomainMapping` collection (`domain` unique-indexed →
`restaurantId`) plus a resolution step early in the Express pipeline that reads the incoming
request's `Host` header, looks up a mapped domain, and attaches the resolved `restaurantId` to the
request the same way slug-resolution already does today for `/r/:slug` — the rest of the stack
(controllers, tenant middleware) wouldn't need to change, since it already treats "which restaurant"
as something resolved once, early, and then trusted for the rest of the request. On `apps/web`
(a plain SPA, no server), a custom domain would need either (a) a bootstrap-time API call resolving
`Host` → restaurant slug before `RestaurantContext` mounts, or (b) the SSR/edge layer already
flagged as a known gap in this same doc's SEO section — the two problems (crawler-visible metadata,
custom-domain resolution) would likely get solved by the same eventual architectural change.
SSL/DNS provisioning for a custom domain is a hosting/ops concern (e.g. a provider API like
Vercel's or Cloudflare's), not an application-architecture one, and is explicitly out of scope here.

**Why this wasn't attempted now**: no restaurant has asked for a custom domain yet; building the
`DomainMapping` model and resolution middleware without a real domain to test against, and without
having decided (a) vs (b) above for the frontend, risks the same "guessed shape" problem as
multi-location.

**What's already safe and needs no rework later**: `slug` remains the canonical internal identity
of a restaurant regardless of what a future custom domain resolves *to* — exactly as this doc's
Phase 8 section already noted. A custom domain is additive routing on top of the existing model,
not a replacement for it.

## Phase 18 — Business/Location Foundation (implemented; supersedes Phase 16's proposed shape)

Phase 16 (above) sketched multi-location as "`Restaurant` becomes a Brand, gaining a child
`Location` collection" that would carry address/coordinates/settings, implying every operational
document (`Order`, `Table`, `MenuItem`, ...) would eventually need to move from `restaurantId` to a
new `locationId`. Phase 18 implements a **different, smaller-footprint shape** after actually
reconnoitering the codebase in depth (Phase 16's proposal was explicitly "documentation only,"
written without that verification): `Restaurant` **is** the location, unchanged, and a new,
thin `Business` model sits above it purely for ownership/identity grouping. This is a deliberate
correction, not an inconsistency — the reasoning follows.

### Why this shape, not Phase 16's

`Restaurant` already *is* a location-shaped document — it has always carried `address`,
`latitude`/`longitude`, `slug`, and a `settings` subdocument with `currency`, `timezone`,
`businessHours`, delivery radius/fee, and payment toggles, all of which are inherently
per-physical-place facts. Moving those onto a brand-new `Location` collection (Phase 16's
proposal) would mean cascading a `locationId` through `Order`, `Table`, `MenuItem`, `Category`,
`ModifierGroup`, `Promotion`, `LoyaltyAccount`, `Payment`, `Refund`, and `AuditLog`, rewriting
~20 route files' tenant param from `:restaurantId` to `:locationId`, and touching every frontend
page that fetches by restaurant — the exact "touches nearly every collection in the system" cost
Phase 16 itself named as the reason not to attempt it speculatively.

Keeping `Restaurant` as the location and adding `Business` as a new parent achieves the identical
domain goal (an owner/manager can be associated with more than one physical location) for a
fraction of the blast radius: every existing route, slug, QR code, JWT claim, order number
sequence, menu item, and frontend page keeps working **byte-for-byte unchanged**, because nothing
about what `Restaurant` means or how it's queried changes. The only new concept is a link from
`Restaurant` up to an owning `Business`. `Restaurant` is not renamed to `Location` in code this
phase (that mechanical rename buys no safety and was explicitly deferred — see below).

### Domain model

- **`Business`** (new model, `apps/api/src/models/Business.ts`) — the commercial/brand entity:
  `name`, `slug` (unique), `description`, `logo`, `coverImage`, `ownerId` (ref `User`), `status`
  (`pending`/`active`/`suspended`), `brandColor`. Deliberately has **no** `currency`/`timezone`
  fields — those stay purely location-level (see scope table below), so nothing forces every
  location of a business onto one timezone or currency.
- **`Restaurant`** (existing, extended) — gains `businessId: ObjectId` (ref `Business`, required
  after migration, indexed). Everything else is unchanged.
- **`User`** — gains `businessId?: ObjectId` and `locationIds: ObjectId[]` (default `[]`) as new,
  additive fields. The existing `restaurantId` field is untouched and remains the sole source of
  truth for every pre-Phase-18 route's authorization (`requireTenantMatch`, the JWT, every
  controller) — this is what makes the migration zero-risk to the already-shipped product.
  `businessId`/`locationIds` back an entirely new, additively-wired authorization path
  (`requireBusinessMatch`/`requireLocationAccess`, `middleware/businessLocation.ts`) that no
  existing route uses yet.

### Scope classification (per subsystem)

| Domain | Scope | Status |
|---|---|---|
| Orders, Tables/QR, delivery config, timezone, business hours, currency | Location (`Restaurant`, unchanged) | Already correct — no change was needed, since `Restaurant` was always location-shaped |
| Payments/Refunds | Follow the Order → Location; provider config stays platform-level | Already correct — no change needed |
| Menu (`Category`/`MenuItem`/`ModifierGroup`) | **Target**: business-scoped canonical item + location-level availability override | Documented target only, deliberately not built this phase (see below) |
| Loyalty, Promotions, order-number sequencing | Stays location-scoped (today's `restaurantId`-keyed uniqueness) | Unchanged; explicit future decision — only move to business-scoped if a real multi-location owner needs shared loyalty balances or promo codes across locations |
| Customers | Already business/location-agnostic — `User(role=customer)` was never restaurant-scoped; per-location customer lists are computed by aggregating `Order`s | Already correct |
| Business-level analytics aggregation ("all locations combined") | New capability | Deferred — see currency-aggregation warning below |
| Multi-business-per-user ("agency" access) | `User.businessId` is singular, same shape as today's `restaurantId` | **Known, accepted limitation** — not fixed this phase, written down so it's a deliberate tradeoff, not a rediscovery |

**Menu — why the schema wasn't touched this phase**: `MenuItem`/`ModifierGroup` today are fully
independent, denormalized documents (their own `name`/`price`/`description`), with no
canonical/template concept and no clone tooling anywhere in the codebase. Adding a `businessId`
scoping field to them now would not implement "shared menu" — it would only let you filter across
a business's items, a different and less useful thing, and could mislead a future reader into
thinking the scoping field *is* the solution. The actual target shape, for whenever this is
built: a business-scoped canonical `MenuItem` plus a new, sparse `MenuItemLocationOverride`
collection (`{businessId, locationId, menuItemId, isAvailable}`) — only rows for items actually
hidden at a specific location need exist. At that point, `orderPricing.service.ts`'s
tenant-isolation guard (`MenuItem.find({_id, restaurantId, isAvailable:true})`, which today trusts
`{_id, restaurantId}` together as proof of ownership) needs a real redesign, not just a rename:
once menu items aren't restaurant-owned documents, "available at a sibling location of the same
business" must never be sufficient to let a customer order it at a different location — that
check has to become an explicit per-location lookup, not an implicit side effect of a shared
`businessId` filter.

**Business-level analytics — the currency-aggregation guardrail**: whenever a "revenue across all
of my business's locations" endpoint is built, it must never sum `Order.total` across locations
with different `settings.currency` values into one number — that's mathematically invalid (summing
USD + EUR + GBP). Either require all locations under one business to share a currency (simplest,
enforceable at location-creation time) or return a currency-keyed breakdown, never a single blended
total.

### Explicitly deferred (not built this phase)

- Renaming `Restaurant` → `Location` in code/routes/frontend — no safety benefit, high blast radius.
- Any admin or storefront UI for creating/switching/viewing multiple locations, or picking an
  existing business when creating a restaurant (the backend capability exists — see below — but has
  no UI consumer yet).
- Actually building the shared-menu-with-override data model described above.
- Business-level analytics aggregation endpoints.
- `Order.orderNumber` / `LoyaltyAccount` / `Promotion` uniqueness-scope changes.
- `Business` getting its own `slug`/storefront landing page.
- Cascading `Business.status` suspension down to actually blocking orders — the field exists and is
  migrated to a sane value (mirrored from the source `Restaurant.status`), but no controller can
  currently change it away from that value, so there is no live enforcement gap today, just an
  inert field ready for the next phase to wire up.
- `brandColor` resolution: `Restaurant.settings.brandColor` remains authoritative for what actually
  renders on a location's storefront (unchanged — it's the only one any render path reads today);
  `Business.brandColor` is a future pre-fill convenience for creating new locations under a
  business, not consumed by any render path yet. Written down explicitly so it isn't left ambiguous
  for whoever builds the next UI on top of it.

### What was actually implemented

- `Business` model; `Restaurant.businessId`; `User.businessId`/`User.locationIds`.
- `createRestaurant` (`restaurant.controller.ts`) — now accepts an optional `businessId` in its
  request body. Omitted: today's exact behavior, plus a `Business` is created alongside the
  `Restaurant` in the same transaction. Provided: creates a **second location under an existing
  business** (no new owner invited — the existing business's owner already has implicit access to
  every location under their `businessId`) — this is the concrete proof that a business can have
  multiple locations, reusing the existing, already-tested transaction shape.
- `inviteStaff`/`updateStaff` (`staff.controller.ts`) — new staff now also get `businessId` and
  `locationIds: [restaurantId]` set at invite time; `updateStaff` can PATCH `locationIds`, laying
  the groundwork for a staff member covering more than one location without yet building a
  multi-select UI for it.
- JWT/`req.user` — `businessId`/`locationIds` added as new optional claims, re-derived from the
  current `User` document at every login/refresh (never copied from an old token, so a staff
  member's location grant changes take effect on next login/refresh).
- `middleware/businessLocation.ts` (new file, additive alongside `middleware/tenant.ts`, not a
  replacement) — `requireBusinessMatch`/`requireLocationAccess`, wired into three new, net-new
  routes under `/businesses` (`GET /businesses/me`, `GET /businesses/:businessId/locations`,
  `GET /businesses/:businessId/locations/:locationId`) that exercise the whole path — real JWT
  claims through real middleware to a real DB lookup — over an actual HTTP round trip. No existing
  route was modified to use this new authorization path.
- `apps/api/src/scripts/migrateToBusinessLocation.ts` — idempotent, two-pass migration (Restaurant→
  Business backfill, then User sync), with a pre-flight check that fails loudly rather than
  silently if it finds one `ownerId` reused across multiple `Restaurant` documents (which the naive
  one-Business-per-Restaurant migration would otherwise incorrectly split into two Businesses).

## Phase 19 — Multi-Location Admin Product Experience

Phase 18 built the Business/Location data model but deliberately stopped at the backend. Phase 19
turns it into a real, usable admin product: an owner can create a second location through the real
UI, switch between locations, and have every location-scoped page (Orders, Menu, Kitchen, Staff,
Delivery, Settings, ...) correctly follow the switch — while a single-location business (still the
overwhelming majority) never sees any of this complexity at all.

### The central correction to Phase 18

Reconnaissance before implementation (required by this phase's own brief, and good practice
regardless) found that Phase 18's design, while safe, left the product **unable to actually use**
its own new capability: every real restaurant-scoped route was, and had to remain, guarded by
`requireTenantMatch` — a strict equality check against the single `restaurantId` baked into a
user's JWT at login. Phase 18's `requireLocationAccess` (which *did* correctly grant business-wide/
location-scoped access) was deliberately wired into zero real routes, specifically to avoid
touching existing routes' live behavior. The consequence: an owner with implicit access to a second
location could never actually reach it through Orders, Menu, Kitchen, Staff, or any other real
page, no matter what frontend was built on top.

**Fix**: `requireTenantMatch` (`apps/api/src/middleware/tenant.ts`) is unified rather than left as
two parallel authorization systems. Its core logic is extracted into a plain, non-Express function,
`canAccessRestaurant(user, targetRestaurantId)`, reused by both the Express middleware and the
Socket.IO handshake (see below) — a single implementation, not two copies that could drift out of
sync. The original single-`restaurantId` fast path is checked first and is completely unchanged
(synchronous, zero DB cost) — the single-location case, still nearly every account, pays nothing
for this. The new fallback (owner/manager: `businessId` match against the target restaurant, one
indexed lookup; staff/kitchen_staff: explicit `locationIds` membership, no DB call) only runs once
that fast path has already failed. `requireLocationAccess` is retired (redundant once
`requireTenantMatch` covers its logic); the one route that used it
(`GET /businesses/:businessId/locations/:locationId`) now calls
`requireTenantMatch('locationId')` instead. `requireBusinessMatch` stays — a genuinely different,
business-level (not location-level) check with no equivalent in `tenant.ts`.

This correction is validated by both new unit tests (`middleware/tenant.test.ts`, covering the
async fallback branches in isolation) and, per the explicit recommendation that a middleware-only
test can't prove a real route actually grants access, a real-route integration suite
(`controllers/business.controller.test.ts`'s "requireTenantMatch's businessId fallback reaches REAL
restaurant-scoped routes" block) — a manager operating a second location through the real
`GET .../orders` and `PATCH /restaurants/:id` routes, not just the `/businesses` proof endpoints.

### A second real gap found during reconnaissance

`GET /businesses/:businessId/locations` (`listBusinessLocations`) returned every location under a
business to any caller whose `businessId` matched, regardless of role — meaning a staff member
explicitly restricted to one location via `locationIds` could still see every sibling location's
name/slug/address in that response, even though they had no ability to actually operate them. Fixed
by filtering the query to the caller's own `locationIds` when the role is
`restaurant_staff`/`kitchen_staff`; owner/manager/`platform_admin` keep seeing everything, matching
their access everywhere else.

### Admin frontend architecture

**`LocationContext`** (`apps/admin/src/context/LocationContext.tsx`) — the admin-app analog of
`apps/web`'s `RestaurantContext`, except "which restaurant" is never a URL param here (every admin
route is bare — `/orders`, not `/orders/:restaurantId`). Once `user.businessId` is known, it fetches
`GET /businesses/:businessId/locations`, resolves the active location (a valid, still-accessible
localStorage preference for this business > the user's own original `restaurantId` > the first
accessible location), and exposes `activeLocationId`/`locations`/`switchLocation()`/
`refetchLocations()`. **localStorage is a UI preference only, never an authorization input** — every
request is still independently authorized server-side by `requireTenantMatch`, so a tampered/stale
localStorage value can at worst show the wrong (but still authorized) location, never an
unauthorized one. Proven directly by `e2e/multi-location-staff-isolation.spec.ts`, which tampers
with localStorage to claim an unauthorized location and confirms the client falls back to the
real, authorized one rather than trusting it.

**15 admin pages** (Dashboard, Orders, Kitchen, Menu, Customers, Delivery, Tables, Promotions,
Loyalty, Analytics, Staff, Support, Settings, Audit log, Setup) changed their one `const
restaurantId = user!.restaurantId!;` line to `useActiveLocationId()` instead — mechanical,
one-line-plus-import per file. `useRestaurantCurrency`/`useRestaurantTimezone`
(`apps/admin/src/hooks/`) and four pages (Dashboard, Settings, Delivery, Setup) had a second,
easy-to-miss bug in the same family: they called `GET /restaurants/me`, which resolves purely from
the JWT's own baked-in `restaurantId` — meaning a multi-location user switching locations would
still see their *original* location's currency/timezone/settings forever. Fixed by adding
`GET /restaurants/:restaurantId` (guarded by the same `requireTenantMatch`, same response shape as
`/me`) and pointing all of these at the active location instead.

**Remount-on-switch**: the routed page area (`Layout.tsx`'s `<Outlet key={activeLocationId}>`)
forces a full remount of whatever page is showing on every switch. This is not just a safety
margin — `StaffPage`/`MenuManagementPage`/`AuditLogPage` all fetch with a mount-only
`useEffect(() => {...}, [])`, no `restaurantId` in the dependency array at all, so without the
forced remount they would silently keep showing the previous location's data indefinitely after a
switch. Only the currently-displayed page's local state is lost (open modals, in-progress form
fields) — `Layout` itself (nav, header, socket status) lives outside the keyed subtree.

**Socket.IO**: room membership used to be derived once, at connection handshake, purely from the
JWT's baked-in `restaurantId` — with no live "leave room X, join room Y" mechanism. Since switching
the active location client-side doesn't issue a new JWT, Kitchen realtime for a switched-to
location would silently keep listening to the *previous* location's room unless something changed.
Fixed by extending the Socket.IO handshake's `auth` payload with a client-supplied `locationId`
(`packages/utils/src/socketClient.ts`'s `auth` was already a callback re-invoked on every
connection attempt, so this was cheap), verified server-side via the same `canAccessRestaurant`
function before the server honors it — never trusted from the client alone, exactly like a URL
param. `LocationContext.switchLocation()` does a real `disconnect()`+`connect()`, not a live
in-place room swap — deliberately simpler, and structurally can't leave a stale room membership
lingering alongside the new one. The very first connection's trigger was also moved from
`AuthContext` (which used to connect the instant `user` was set) to `LocationContext` (which
connects once `activeLocationId` has actually resolved) — connecting before that resolution would
guarantee an extra, immediate reconnect for every multi-location user on every page load.

**Known, accepted limitation**: authorization for an already-connected socket is checked once, at
handshake — not per-event. If an owner revokes a staff member's location access mid-session, that
socket keeps receiving events for the old room until their access token expires and forces a
reconnect. This is not a new gap Phase 19 introduced — it's the same pre-existing property of the
`restaurantId`-in-JWT design, just now also true of the `locationId` claim.

### New surfaces

- **`LocationsPage`** (`apps/admin/src/pages/LocationsPage.tsx`, route `/locations`) — the owner-facing
  home for location management. Deliberately minimal at 1 location ("You have 1 location: X · [+ Add
  another]") rather than presenting management complexity nobody needs yet. Gated by
  `restaurant.settings.manage` (owner-only — `restaurant_manager` does not hold this permission,
  matching Settings/Delivery's existing gating; not widened as an incidental side effect of this
  phase).
- **`POST /businesses/:businessId/locations`** (new route) — the owner-facing counterpart to Phase
  18's `createRestaurant` `businessId` branch. `POST /restaurants` stays `platform_admin`-only (a
  different trust model — onboarding an entirely new business); this new route is
  `requireBusinessMatch` + `requirePermission("restaurant.settings.manage")`, never trusting a
  client-supplied `businessId` for authorization.
- **Staff page location assignment** — when a business has more than one location, the existing
  staff list gains a small per-row location checkbox set (PATCHing `locationIds`, backend capability
  already built in Phase 18) for `restaurant_staff`/`kitchen_staff` rows only — a manager gets
  implicit business-wide access regardless of `locationIds`, so showing the control for that role
  would be actively misleading. Hidden entirely at 1 location.
- **Platform admin** — `PlatformRestaurantDetailPage` gained one fact ("Business: N locations",
  shown only when >1) via a new `businessLocationCount` field on
  `GET /platform/restaurants/:id`. Deliberately not a new business/location hierarchy view.

### Menu — clone-on-creation, not the full shared architecture

The full "business-scoped canonical item + location override" architecture Phase 18 documented as
the eventual target was evaluated and explicitly deferred again this phase: it requires redesigning
`orderPricing.service.ts`'s tenant-isolation guard (which today proves a menu item belongs to a
restaurant via strict `{_id, restaurantId}` equality — a shared-item model breaks that core
invariant and needs a real replacement, not a rename), and is independently as large and risky as
everything else in this phase combined.

Instead: each location keeps a fully independent menu (`Category`/`MenuItem`/`ModifierGroup`
unchanged, still `restaurantId`-scoped), with an optional **one-time clone** convenience when
creating a new location (`cloneFromLocationId` on `POST /businesses/:businessId/locations`,
implemented in `services/menuClone.service.ts`, run inside the same transaction as the location's
own creation so a failure partway through rolls back cleanly rather than leaving a half-set-up
location behind). The clone produces entirely new, independent documents — editing the copy never
affects the source, and there is no ongoing sync. `cloneFromLocationId` is independently
re-verified server-side to belong to the same business — never trusted from the request body alone.
Each cloned document records a `clonedFrom*Id` provenance field (`select: false` — internal-only,
never exposed via `@restaurant/types` or any API response) as a near-zero-cost hook for a future
shared-menu migration to detect "never touched since cloning" vs. "diverged" — nothing in the
product reads it today. `imageUrl` is copied as a literal shared URL, not duplicated storage —
intentional.

### What stayed deliberately untouched this phase

The full shared-menu/override architecture and `orderPricing.service.ts`'s redesign (above).
`Order.orderNumber`/`LoyaltyAccount`/`Promotion` uniqueness scope (still location-scoped, per Phase
18's original decision — unaffected by anything in this phase). Business-level analytics
aggregation. White-label/custom domains, agency/multi-business users, a public API, POS
integrations, CRM, billing — all explicitly out of scope per the brief.

### A pre-existing, unrelated test fragility found and fixed along the way

Two pre-existing Playwright specs (`platform-admin-tenant-management.spec.ts`,
`platform-restaurant-detail.spec.ts`) located the seeded "Spice Route" restaurant by assuming it
would always be on the admin Restaurants list's default (unfiltered, newest-first) first page. As
this shared local dev database has accumulated real restaurants from every E2E spec's own
real-UI-driven provisioning across many phases' test runs, the seeded restaurant eventually aged
off page 1 — unrelated to any Phase 19 code change, but discovered by Phase 19's own regression
run. Fixed durably (not just for this session) by having both specs search for "Spice Route"
explicitly, using the same search box `platform-pagination-filters.spec.ts` already exercises
against the real backend, rather than relying on default-page visibility that will only keep
degrading as the dev database keeps growing over future phases.

## Phase 20 — Shared Menu Architecture & Location Override System

Phase 19 explicitly deferred the "business-scoped canonical item + location override" menu
architecture that Phase 18's own docs had already sketched as the eventual target (see that
section above), because it requires redesigning `orderPricing.service.ts`'s tenant-isolation
guard — the query that proves a menu item genuinely belongs to the restaurant a customer is
ordering from. That guard (`MenuItem.find({_id, restaurantId, isAvailable:true})`) is a strict
`{_id, restaurantId}` compound-equality check; once menu items stop being restaurant-owned
documents, "available at a sibling location of the same business" must never be enough to let a
customer order it at a different location. Phase 20 builds this architecture.

### Scope decision for this session: backend-safe checkpoint, not a full cutover

Given the stakes (this is the first phase where a design mistake is a pricing/security bug, not a
UX gap), the user explicitly chose a conservative scope: build and fixture-test the full
architecture end to end, but do **not** run the real migration against the dev database, do
**not** retire the old per-location write endpoints, and do **not** touch the admin Menu UI this
session. Every new/changed read and write path is **dual-path**: it checks whether the target
business's canonical menu is actually populated (`businessHasCanonicalMenu`, a single indexed
`MenuItem.exists({businessId})` check) and falls back to the original, byte-for-byte-unchanged
`restaurantId`-scoped logic otherwise. This makes every piece of this phase safe to ship even
before any real migration ever runs — every existing restaurant (100% of them, as of this phase)
is provably unaffected, verified by the full pre-existing Jest and Playwright suites passing
unmodified. Running the real migration, retiring the old write endpoints, and rebuilding the admin
Menu UI are Phase 21's job — see "What Phase 21 still owes," below.

### Domain model

- `Category` / `MenuItem` / `ModifierGroup` gain `businessId: ObjectId` (ref `Business`, indexed) —
  optional at the schema level, same treatment `Restaurant.businessId` got in Phase 18. Populated
  only by the (not-yet-run) migration. The legacy `restaurantId` field is **not removed** — it
  stays required and populated on every document, but becomes dead/forensic-only the instant a
  document also carries `businessId`; no query ever reads both fields on the same document.
- Three new, sparse per-location override collections — a row exists only when a location's
  effective value for an overridable field actually diverges from the canonical default:
  - `CategoryLocationOverride { businessId, locationId, categoryId, isActive?, sortOrderOverride? }`
  - `MenuItemLocationOverride { businessId, locationId, menuItemId, isAvailable?, priceOverride?, sortOrderOverride? }`
  - `ModifierGroupLocationOverride { businessId, locationId, modifierGroupId, isActive?, optionOverrides?: [{optionId, isActive?, priceAdjustmentOverride?}] }`
  - Each has a unique compound index on `{locationId, <entity>Id}` — one override row per entity
    per location.
- A canonical item that should exist but only ever be sold at one location (a "location
  exclusive") needs no separate concept: it's modeled as canonical-hidden (`isAvailable: false`)
  plus exactly one override row at that one location turning it on. The migration (below) uses
  this same mechanism for menu content that has no canonical counterpart anywhere else.

### Menu scope matrix

| Field | Classification |
|---|---|
| `businessId` (all 3 models) | Business-owned, immutable |
| `Category.name`, `description` | Business-owned, **no override** — a different name is a different category, not a variant |
| `Category.sortOrder`, `isActive` | Canonical default, **overridable** |
| `MenuItem.categoryId`, `name`, `description`, `imageUrl` | Business-owned, **no override** — consistent branding is the point of "canonical" |
| `MenuItem.price` | Canonical default, **overridable** (`priceOverride`) — real chains price the same dish differently per location |
| `MenuItem.isAvailable`, `sortOrder` | Canonical default, **overridable** |
| `ModifierGroup.name`, `minSelect`, `maxSelect` | Business-owned, **no override, deferred** — per-location selection-rule divergence would add real risk to `orderPricing.service.ts`'s validation logic for a use case nobody has asked for |
| `ModifierGroup.isActive`, `sortOrder` | Canonical default, **overridable** |
| `options[].name` | Business-owned, **no override** |
| `options[].priceAdjustment`, `isActive` | Canonical default, **overridable** |
| `clonedFrom*Id` (all 3 models) | Deprecated as a *product* concept, but load-bearing for the migration's provenance-based doc-matching (below); never read by product code once migrated |
| legacy `restaurantId` (all 3 models) | Immutable, forensic-only once `businessId` is set |

### `resolveMenuForLocation` — the single authoritative merge

`apps/api/src/services/menuResolution.service.ts`'s `resolveMenuForLocation(businessId, locationId,
{includeHidden})` is the one place canonical + override merge logic lives. It parallel-fetches the
business's canonical `Category`/`MenuItem`/`ModifierGroup` and the location's three override
collections, merges each canonical doc with its (possibly absent) override into an effective view,
and returns the **exact existing** `{items, categories, modifierGroups}` shape every caller already
expects. `includeHidden: false` (public/storefront) drops anything whose *effective*
isActive/isAvailable is false; `includeHidden: true` (staff) keeps everything. Every entity's
`restaurantId` field in the response is deliberately set to the requested `locationId`, not the
underlying `businessId` — `apps/web/src/context/CartContext.tsx` reads `item.restaurantId` as its
cross-restaurant cart-mixing guard, so this DTO field had to keep meaning "which location," not
"which business." `businessHasCanonicalMenu(businessId)` (same file) is the cheap existence check
every dual-path call site uses to decide which path to take.

### `orderPricing.service.ts` — the actual trust boundary, redesigned dual-path

The core fix this phase exists to deliver. The legacy path is untouched, byte-for-byte:
`MenuItem.find({_id, restaurantId, isAvailable:true})`. The new canonical path replaces the old
single-step "ownership" proof with two independent steps: (1) the item genuinely belongs to this
**business** (`{_id, businessId}`), and separately (2) it resolves to effectively available at
**this specific location** once its override (if any) is applied. Step 2 is never implied by step
1 — an item merely existing somewhere in the business (e.g. available at a sibling location via its
own override) is never sufficient; only this location's own effective `isAvailable` counts. Both
paths produce the identical internal `EffectivePricingItem`/`EffectivePricingGroup` shape, so every
line below the resolution step (modifier validation, price computation, the final
`PricedOrderItem`/`Order.items` snapshot) is completely unchanged and unaware of which path ran.
Same effective-price rule for modifier groups and individual options, via
`MenuItemLocationOverride`/`ModifierGroupLocationOverride`.

Order-snapshot immutability was already guaranteed by the existing design (`Order.items` is a full
copy, never a live reference) — this phase only had to prove the override-resolved price at
*creation* time is correct; a dedicated test creates an order, then mutates both the canonical
price and the location's own override afterward, and confirms the stored order is untouched.

### Read cutover — dual-path, not migration-gated

`listMenu` (public, Redis-cached) and `listAllMenuItems` (staff, uncached) both call
`resolveCanonicalBusinessId(restaurantId)` first (a two-step check: does this restaurant have a
`businessId`, and does that business have a populated canonical menu) and route to
`resolveMenuForLocation` only when both are true; otherwise they run the original
`restaurantId`-scoped queries unchanged. Verified in this session's real dev environment (not just
tests): `GET /restaurants/:id/menu` for the seeded "Spice Route" restaurant (not migrated) returns
the identical legacy-shaped payload it always has.

### Caching

The cache key shape is unchanged (`menu:{restaurantId}:available`, 60s TTL) — the resolver is cheap
and the TTL is already short, so a second cache tier wasn't justified. What's new is
`invalidateMenuCacheForBusiness(businessId)` (`menuCache.service.ts`) for canonical writes — it
looks up every `Restaurant._id` under that business (one indexed query) and `DEL`s each location's
key, so a canonical edit correctly busts every dependent location's cache, not just one. Not yet
called from any live route this session, since canonical write endpoints are Phase 21's job — built
and unit-tested ahead of that cutover.

### Clone-on-creation, redesigned around canonical sharing

The user explicitly chose to **keep** the "clone menu from another location" convenience available
at location-creation time, rather than deprecating it now that canonical sharing exists (a real
design fork from this phase's initial draft plan). Reconciled as follows: once a business has a
canonical menu, a new location has no independent documents to "clone into" — it already inherits
the entire canonical menu automatically. So `cloneFromLocationId` is reframed as **"seed this new
location's overrides from another location's current divergences,"** not "copy documents." A
location's own override rows already ARE exactly its divergence from canonical, so cloning is
simply copying the source location's override rows onto the target location
(`menuClone.service.ts`'s `seedLocationOverridesFromSource`) — no parallel storage system, and the
new location still receives every future canonical addition/edit automatically, exactly like any
other location. Cloning only front-loads a divergence snapshot; it never severs the business
relationship. For a business not yet migrated, `cloneMenuToRestaurant` keeps calling the original
Phase 19 whole-document copy path (`cloneMenuDocumentsToRestaurant`) unchanged — same dual-path
rule as everywhere else in this phase. `business.controller.ts`'s `createLocationForBusiness` call
site itself didn't need to change beyond passing `businessId` through — the dispatch lives entirely
inside `menuClone.service.ts`.

### Migration — built and fixture-tested, NOT run against real data this session

`apps/api/src/services/menuBusinessMigration.service.ts` (mirrors
`businessLocationMigration.service.ts`'s shape) + a thin `scripts/migrateMenuToCanonical.ts` CLI
wrapper with a `--dry-run` flag (a new precedent for this repo's migration scripts, added
deliberately given this phase's stakes — no earlier migration here had one).

Per business (skipped if already migrated, via the same `businessHasCanonicalMenu` gate):

1. **Elect the anchor** = the business's oldest `Restaurant` (`createdAt` ascending, deterministic,
   no config needed). Promote its own `Category`/`MenuItem`/`ModifierGroup` documents in place
   (`$set businessId`) — zero data movement, its own effective menu is unchanged by construction.
2. **For every sibling location** (multi-location businesses only — the overwhelming
   single-location majority stops at step 1): match each sibling document to a canonical anchor
   document, **provenance-first** — if `clonedFrom*Id` resolves to the anchor, that's the match;
   only fall back to case-insensitive name matching (scoped to the correct parent, so an item can't
   "match" one under an unrelated category) when provenance is absent or broken.
   - **Matched, unchanged since cloning** → no override row needed (canonical default is already
     correct); the redundant sibling document is deleted.
   - **Matched, diverged** (different price/availability/sortOrder/etc.) → one override row
     capturing exactly the sibling's actual values; sibling document deleted.
   - **No match at all** (an organically independent item, or a menu built with no clone step ever)
     → the sibling's own document is *promoted* into canonical in place (hidden by default
     everywhere else) plus one override row at that sibling's own location turning it back on — the
     same "location exclusive" mechanism from the domain model, reused here so the migration is
     safe even for menus that never went through Phase 19's clone tooling.
   - Modifier group options are diffed per-option by name (options carry no provenance id of their
     own).
3. One Mongo transaction per business (manually started/committed, not `session.withTransaction`,
   specifically so a `dryRun` run can execute the identical logic against a consistent snapshot and
   then always abort instead of committing — nothing persisted, but the returned summary reflects
   exactly what a real run would do).

**Correctness proof** (tested this session, fixtures only): for all four representative business
shapes — single-location; multi-location with untouched clones; multi-location with diverged
clones; multi-location with organic/no-provenance menus — `resolveMenuForLocation` returns an
identical effective menu immediately before and after migration, and running the migration twice is
a no-op.

**Not done this session, and why**: deleting a multi-location business's redundant sibling
documents (once matched/merged into canonical + override rows) is **not byte-for-byte reversible**
— the effective menu is fully reconstructible, but original document `_id`s are not recovered by a
rollback. Single-location businesses remain trivially reversible (`$unset businessId`, no
deletions ever happen for them). Before this migration is ever run for real, the runbook needs a
`mongodump` of the `categories`/`menuitems`/`modifiergroups` collections first — deliberately
deferred to Phase 21 alongside actually flipping the product's write paths and admin UI over.

### Security testing

Every canonical-path branch was tested against the exact failure mode the docs originally flagged:
an item canonical to a *different business* is rejected; an item hidden by canonical default with
no override at this location is rejected; an item hidden at *this* location via override despite
being canonical-available is rejected; and — the specific bug class this phase exists to close — an
item available at a *sibling* location via that sibling's own override, but not available at the
requested location, is rejected. The charged price always equals the requested location's own
effective price: never the canonical default when an override exists, never a sibling's override.
Proven both as direct unit tests against `priceOrderItems` and as full HTTP-level integration tests
through the real `POST /restaurants/:id/orders` route against a genuinely migrated two-location test
business — extending, not duplicating, the existing "Phase 8 cross-tenant order attempt" test
pattern to the business boundary.

### What stayed deliberately untouched this phase

The old per-location write endpoints (`POST/PATCH/DELETE /restaurants/:restaurantId/menu|
categories|.../modifiers`) — retiring them has to happen in the same piece as actually running the
migration (once `restaurantId` is dead on a migrated business's documents, their `{_id,
restaurantId}` filters would silently match nothing). The admin Menu UI
(`MenuManagementPage.tsx`) — still a plain per-location editor with no concept of canonical vs.
override; Phase 21's job. Business-level analytics, promotions, and loyalty — unaffected by this
phase, as designed (promotions/loyalty compute against order `subtotal`/`total`, never reference a
`menuItemId`, so they're structurally insulated from the menu architecture change). Any new admin
UI, realtime menu-change events, or search/filter endpoints — none of these existed before this
phase and none were added; not required for correctness (the storefront simply refetches).

### What Phase 21 still owes

1. Run the real migration against the dev database, with the `mongodump` backup step, for every
   existing multi-location business.
2. Retire the old per-location menu write endpoints, replaced by a canonical (`/businesses/
   :businessId/menu|categories|.../modifiers`, gated by `requireBusinessMatch`) + per-location
   override (`/restaurants/:restaurantId/menu/:id/override`, gated by the existing
   `requireTenantMatch`) route split.
3. Rebuild `MenuManagementPage` into a canonical editor plus a "this location's differences" panel
   — price/availability override inputs, a clear inherited-vs-overridden indicator per field, and a
   "reset to canonical" action.
4. Once no unmigrated business remains, remove the legacy fallback branches (`restaurantId`-scoped
   queries in `orderPricing.service.ts`/`menu.controller.ts`, the whole-document clone path in
   `menuClone.service.ts`) — dual-path was a deliberate, temporary safety net for this phase, not
   the permanent shape of the code.

## Phase 21 — Shared Menu Productization, Migration & Owner Experience

Phase 20 built the shared-canonical-menu architecture as a dormant, dual-path backend checkpoint —
correct, fixture-tested, but never run against real data, with the old per-location write endpoints
still live and the admin UI unaware the new model existed. Phase 21 finishes the transition: the
real migration ran, the old write endpoints were retired (per-business, runtime-checked), and the
admin UI was rebuilt around canonical items + per-location overrides — without a single existing
restaurant losing functionality.

### Domain model change

One schema change, the only one this phase made: `restaurantId` on `Category`/`MenuItem`/
`ModifierGroup` went from `required: true` to conditionally required
(`required: function(this){ return !this.businessId; }`). A canonical-only document (created via
the new business-scoped write API, below) has no single owning location to populate it with; a
legacy, not-yet-migrated document keeps requiring it exactly as before. `ModifierGroupDoc`'s
TypeScript interface changed to match (`restaurantId?: Types.ObjectId`).

### New write API

Two parallel write surfaces now exist per entity type (`Category`/`MenuItem`/`ModifierGroup`),
added as new functions on the *existing* controllers — not new files, so each entity's logic stays
in one place:

- **Canonical** — `POST/PATCH/DELETE /businesses/:businessId/categories|menu|menu/:menuItemId/modifiers[/:id]`,
  guarded by `requireBusinessMatch()` + the *existing* `restaurant.{categories|menu|modifiers}.write`
  permission (no new RBAC entries — owner/manager already hold it business-wide; staff/kitchen_staff
  hold neither, regardless of scope). Writes set/scope by `businessId`, call
  `invalidateMenuCacheForBusiness(businessId)` (built dormant in Phase 20; these are its first real
  callers).
- **Location override** — `PUT/DELETE /restaurants/:restaurantId/categories/:categoryId/override`,
  `.../menu/:menuItemId/override`, `.../menu/:menuItemId/modifiers/:modifierGroupId/override`,
  guarded by the existing `requireTenantMatch()` + same write permissions. `PUT` is an atomic
  `findOneAndUpdate({locationId, entityId}, {$set: body}, {upsert:true, new:true, runValidators:true})`
  — never find-then-write, since the unique `{locationId, entityId}` index makes a two-step
  read-then-decide racy under concurrent requests. `$set` semantics make `PUT` a **merge**, not a
  destructive replace: only the keys present in the request body are touched, so the frontend always
  sends the full set of override-editable fields it wants preserved. `DELETE` removes the whole
  override row idempotently (204 either way — "no override" is a valid steady state), restoring pure
  inheritance from canonical.
- A combined `GET /restaurants/:restaurantId/menu/overrides` returns every override row
  (`{categoryOverrides, menuItemOverrides, modifierGroupOverrides}`) for a location in one round
  trip — sparse by design, so this stays cheap even for a location with many divergences.
- New DTOs (`packages/types/src/types/override.ts`) and zod schemas (`packages/validation/src/override.ts`,
  all `.refine()`-rejecting an empty body) back both surfaces.

### Retirement of the old write endpoints — per-business, runtime-checked

The old per-location write endpoints (`POST/PATCH/DELETE /restaurants/:restaurantId/menu|
categories|.../modifiers`) are not deleted — deleting them outright would break any business not
yet migrated (every newly-onboarded business, by construction, until a future phase changes that).
Instead, `assertMenuNotMigrated(restaurantId)` (`menuResolution.service.ts`) is the first line of
all nine legacy write functions: it calls the newly-exported `resolveCanonicalBusinessId`, and if
the business has already been migrated, throws a new `ApiError.gone()` (410, `ErrorCode.MENU_MIGRATED`)
pointing the caller at the new canonical/override endpoints instead. This check is **per-business
and evaluated on every request**, not a static route removal — a business rolled back via `$unset
businessId` automatically regains its old endpoints with no redeploy. This was a deliberate
correction of Phase 20's original "dual-path forever" framing: once a sibling location's document is
promoted into canonical (keeping its original `restaurantId`, only gaining `businessId`), the old
endpoint's `{_id, restaurantId}` filter would still match it — a write through the old endpoint
would silently mutate what is now a business-wide canonical document. A passive dual-path, unlike
the read side, was unsafe on the write side; the active per-business cutover above closes that gap.

### The real migration

**Backup.** `mongodump`/`mongorestore` are not installed on this machine (confirmed: no
`mongodump.exe` under `C:\Program Files\MongoDB`, no `docker` CLI available either), so a
purpose-built logical backup was used instead: the `mongodb` Node driver + `bson`'s `EJSON`
(canonical extended JSON, full `ObjectId`/`Date` fidelity) dumped every collection to one `.ejson`
file each. Run against `mongodb://localhost:27017/restaurant_platform?replicaSet=rs0`:

- **Taken at**: 2026-08-22T20:21:47.251Z
- **Location**: session scratchpad (`.../scratchpad/phase21-migration/backup-20260823T012146/`) —
  outside the repo and **not a permanent retention location**; if this migration is ever re-run
  against a different environment, take a fresh backup with the same script rather than relying on
  this one persisting.
- **Contents**: full 22-collection snapshot (all business data — restaurants, businesses, categories,
  menu items, modifier groups, overrides, orders, users, etc.), one `.ejson` file per collection plus
  a `_summary.json` recording per-collection document counts at backup time.
- **Verified restorable**: restored into a scratch database (`restaurant_platform_backup_verify`)
  and every collection's document count compared against the source — all matched exactly, before
  the real migration was trusted to run.

**Rehearsal.** The existing Phase 20 migration service (`menuBusinessMigration.service.ts` +
`scripts/migrateMenuToCanonical.ts --dry-run`) was run in dry-run mode against the real dev database
first (executes the real matching/promotion logic inside a manually-managed transaction, then always
aborts — nothing persisted) and inspected against STOP criteria (any throw; implausible
exclusive-promotion counts; failed backup-restore verification) before proceeding. No architectural
change was made to the migration logic itself — Phase 20's design held up under real data.

**Real run.** Executed via the unchanged `npm run migrate:menu-canonical` script. Result:
**78 businesses migrated**, **30 already-canonical** (investigated and confirmed to be Jest test
fixtures — `"Test Business"`/`test-business-<timestamp>-<n>` slugs — with zero overlap with real
seeded/demo data), **84 businesses skipped** (no locations to migrate — not yet provisioned past
account creation).

**Verification.** Not a hand-picked sample: every migrated business's effective menu (via
`resolveMenuForLocation`) was diffed content-by-content (`{name, price, isAvailable, categoryName}`,
not raw document ids, since ids legitimately change for matched/promoted documents) between a
pre-migration snapshot (restored from the EJSON backup into the scratch database) and the real
post-migration database. The diff tooling itself had a bug on its first run (a raw, un-stringified
`ObjectId` used as a map key against string keys, causing 21 false-positive differences on the
legacy-resolution path) — found and fixed before drawing any conclusion, then the diff was
regenerated from the corrected snapshot and re-run: **4 genuine, fully explained differences**
remained (all sort-order-only reorderings from the migration's deterministic anchor-election, no
price/availability/name changes), **0 unexplained differences** across the full migrated set.

### Owner UX — `MenuManagementPage.tsx` rebuild

Rebuilt around a canonical editor (business-scoped, `user!.businessId`) with an inline "this
location's differences" panel per item/category/modifier group — not a second page, so scope stays
visible in context rather than requiring the owner to navigate between "the menu" and "my
overrides." A single-location owner (still the overwhelming majority) sees no new concepts: their
one location's overrides panel exists but sits empty until they deliberately create a divergence,
and every canonical edit takes effect immediately with no separate "publish to location" step.

For a multi-location owner, each item/category row gains a "This location:" mini-row showing
whether it's overridden here, with inline price-override / hide-here-only inputs and a
"Reset to canonical" button that calls the override `DELETE`. `ModifierGroupsEditor.tsx` got the
same treatment at the group and per-option level — group-level `isActive` override, per-option
price-override, merged against existing `optionOverrides` (since the override `PUT` is a `$set`
merge, not a replace). `LocationsPage.tsx`'s "clone menu from" copy was corrected: every location
already shares the canonical menu automatically now, so cloning only seeds a *starting* divergence
snapshot from another location, not a copy of the menu itself.

### Location UX

No new location-management system — everything reuses the existing `LocationContext`
(`activeLocationId`/`switchLocation`) from Phase 19 unchanged. A newly created location inherits the
full canonical menu with zero setup (proven live end-to-end by `e2e/shared-menu-canonical-override.spec.ts`,
including publishing the new location — which also re-proves the Piece 1 `computeReadiness` fix: a
non-anchor location with no `restaurantId`-scoped documents of its own must still resolve as ready).

### `restaurantReadiness.service.ts` fix

`computeReadiness`'s menu-count check (used both for the readiness UI and as a real server-side gate
on `PATCH /restaurants/:id/publish`) went dual-path: canonical businesses route through
`resolveMenuForLocation` (a naive `businessId`-scoped count would answer the wrong question — it
needs each location's own *effective* menu, not the business's raw canonical count); legacy
businesses keep the original `restaurantId`-scoped query unchanged. Without this fix, migrating a
business would have silently zeroed out every non-anchor location's readiness count, permanently
blocking it from ever publishing — caught and fixed in Piece 1, before the real migration ran.

### Pricing, storefront, cache, security, concurrency

Unchanged from Phase 20's design (`orderPricing.service.ts`'s two-step business-then-location
resolution, `resolveMenuForLocation`'s merge, `invalidateMenuCacheForBusiness`'s per-business cache
busting) — Phase 21 gave these paths their first real callers and real data, but made no design
changes to any of them. Extended test coverage this phase: override-write-as-mutation-source
immutability (an order's stored price is unaffected by a later override edit), `reorderOrder`'s
canonical-path re-pricing and unavailable-item reporting, and a full authorization + concurrency
matrix (owner/manager write, staff/kitchen_staff/cross-business/cross-location rejected, atomic
upsert under concurrent override writes) against real fixture-migrated businesses.

### A real architectural consequence, found and documented explicitly (not a bug)

Under shared-canonical-menu architecture, an item created at (or promoted to canonical from) one
location is visible at every sibling location by default unless an explicit override hides it — this
is the *intended* behavior, not data leakage. It surfaced three times during this phase's own
testing, each resolved the same way: (1) the migration-diff investigation above; (2)
`e2e/multi-location-owner-journey.spec.ts`'s Phase 19-era assertion that a menu item created at
Location A must never appear at Location B — corrected (docstring, title, and assertions rewritten)
to prove the new, correct shared-inheritance behavior instead, with the correction documented
directly in the test file; (3) two other pre-existing specs (`admin-tenant-isolation.spec.ts`,
`menu-rbac.spec.ts`) that captured a real auth token by intercepting the old `/menu/items` network
request — updated to intercept the new `/businesses/:businessId/menu` request instead, since the
rebuilt admin UI no longer calls the old URL.

### What Phase 21 still owes (deliberately deferred)

Removing the legacy dual-path branches entirely (`restaurantId`-scoped queries in
`orderPricing.service.ts`/`menu.controller.ts`, the whole-document clone path in
`menuClone.service.ts`, the retirement guard itself) — "no unmigrated business remains" is never
provably permanent, since a new business starts unmigrated by construction until a future phase
changes that default. White-label/custom domains, agency/multi-business accounts, a public API, POS
integrations, business-wide analytics, and business-wide promotions/billing/branding — all
explicitly out of this phase's scope, reserved for Phase 22.

## Phase 22 — White-Label & Custom Domain Architecture

A verified custom domain (`orders.acme-restaurants.com`) now resolves the exact same storefront a
customer would otherwise reach at `/r/:slug` — as a second, purely additive tenant-resolution
mechanism, never a replacement for the existing one. `/r/:slug` is completely unchanged; every
existing bookmark, QR code, and indexed link keeps working exactly as before.

### Reconnaissance that shaped the design

Two facts about the existing codebase, verified before writing any new code, determined nearly
every design decision below:

1. **`apps/web`'s API client uses a relative `basePath` (`/api/v1`)**, not an absolute origin
   (`packages/utils/src/apiClient.ts`). Whatever hostname the browser is currently on is
   automatically also the origin for every API call and for the httpOnly refresh cookie
   (`credentials: "include"`). This means a custom domain deployed behind the same reverse-proxy/
   CDN that already serves the platform's own domain (proxying both static assets and `/api/v1/*`
   to the same backend) has **no cross-origin/cross-site cookie problem at all** — no CORS change
   was needed anywhere in this phase. This is a deployment-topology requirement (see Infrastructure
   below), not application code.
2. **Cart/order security already worked by construction.** `CartContext` tags cart lines with
   `item.restaurantId`; `CartPage` POSTs to `/restaurants/${restaurant.id}/orders`; `createOrder`
   re-derives everything (items, prices, table, delivery) scoped to that URL's `restaurantId` via
   `priceOrderItems` — a mismatched item 400s regardless of *how* `restaurant.id` was resolved. The
   only genuinely new security-relevant surface this phase introduces is the single new resolution
   step (hostname → `restaurant.id`); everything downstream inherits every existing, already-tested
   guarantee for free, with zero new order/cart/checkout code.

### Domain ownership: Location, not Business

A domain resolves to exactly one `Restaurant` (Location) — proven, not assumed, from the existing
codebase: every render-affecting setting (currency, timezone, delivery config, business hours,
`logo`/`coverImage`/`settings.brandColor`) is already Location-scoped. `Business` carries its own
`logo`/`coverImage`/`brandColor` fields, but the model's own Phase 18 comment already states these
are "purely presentational... not consumed by any render path" — independent confirmation that
Location, not Business, is where a storefront's real identity lives.

### Domain model

New model, `apps/api/src/models/DomainMapping.ts`:

```
hostname: string            // normalized (lowercase, no protocol/path/trailing dot), globally unique
businessId: ObjectId        // denormalized cache (source of truth stays Restaurant.businessId) — cheap
                             // "list my business's domains" queries without a join, same pattern
                             // MenuItemLocationOverride etc. already established for businessId
locationId: ObjectId        // ref Restaurant — the actual, authoritative scope
status: "pending_verification" | "verified" | "active"
verificationToken: string   // raw randomBytes(32) hex — plaintext by design, see below
verificationCheckedAt / verifiedAt / activatedAt: Date?
```

Two indexes carry real invariants, not just query performance:
- `{ hostname: 1 }` unique, globally — a hostname can only ever be one mapping at a time.
- `{ locationId: 1 }` unique **with `partialFilterExpression: { status: "active" }`** — a real
  database constraint guaranteeing at most one active domain per location, closing the exact
  activate/deactivate/delete race a purely application-level check couldn't. A `pending_verification`
  or `verified` row for a *different* candidate hostname can still coexist with the currently-active
  one — this is what makes a domain swap (add the new one, verify it, activate it, then deactivate
  the old one) representable without ever having two active domains, even transiently.

**`verificationToken` is stored in plaintext**, a deliberate departure from this codebase's
invite/reset-token convention (`secureToken.service.ts` persists only a SHA-256 hash, since those
are bearer credentials). A DNS TXT verification value is different in kind: the owner must be shown
the exact value repeatedly to paste into DNS, and the platform re-compares it against live DNS
lookups an unbounded number of times — a hash-only store would make the flow itself impossible.

**Lifecycle** — three states, matching the brief's minimum exactly:
- **Add** → `pending_verification`, generates the token. Rejects the platform's own configured
  domain (`env.CLIENT_ORIGIN`'s hostname) as a candidate — a business can't "verify" the platform
  itself.
- **Check verification** (`POST .../check-verification`, synchronous — a single DNS lookup doesn't
  need a background job) → live TXT lookup at `_tablecloth-verify.<hostname>`; on match, transitions
  to `verified`. Idempotent, and **never** auto-activates — activation is always a separate, explicit
  action.
- **Activate** (only from `verified`) → `active`. A concurrent activate against a location that
  already has a different active domain hits the partial unique index and returns a clean 409, not a
  500 or a silent second active row.
- **Deactivate** (only from `active`) → back to `verified` — the domain stays owned/proven, just not
  currently serving; no re-verification needed to reactivate later.
- **Remove** → hard delete + an `AuditLog` entry (`domain.removed`, metadata `{hostname}`). This
  codebase never soft-deletes comparable entities (slugs are never deleted at all); the audit log is
  the durable historical record. Removal frees the hostname immediately for anyone to re-claim —
  safe, since re-claiming still requires passing verification again, identical to slug reuse.

### Hostname normalization & validation

`packages/validation/src/domain.ts`'s `normalizeHostname` forgives only superficial formatting:
case, surrounding whitespace, a leading `http(s)://`, and a single trailing `/` or `.`. It
deliberately does **not** strip a real path/query — `isValidHostname` (built on a `new URL(...)`
round-trip check) then rejects anything with an actual path/query/fragment, a bare IPv4/IPv6
address, or a single-label value with no dot. `https://example.com/path` is rejected outright, per
the brief's explicit requirement, rather than silently reduced to `example.com` — an early version
of this normalization got this wrong (stripped the path before validating) and was caught by its
own test suite before merge; see Bugs Found in the final report.

### DNS verification service

Mirrors this codebase's existing provider-agnostic-interface pattern (`PaymentProvider`,
`StorageService`) exactly: `apps/api/src/dns/DnsVerifier.ts` (interface: `resolveTxt(hostname):
Promise<string[]>`), `NodeDnsVerifier.ts` (real, Node's `dns.promises.resolveTxt`, wrapped in a
manual `Promise.race` timeout since the module has no native per-call one), `MockDnsVerifier.ts`
(reads a small, directly-Mongo-seedable `MockDnsRecord` collection), selected via `DNS_VERIFIER=
mock|node` (`getDnsVerifier()`, `apps/api/src/dns/index.ts`) — `mock` is the default outside
production, mirroring `PAYMENT_PROVIDER`'s own default-mock precedent. The mock is a genuine,
precedented exception (the same one e2e tests already rely on for reading real invite tokens
directly from Mongo instead of a real inbox), not a shortcut that bypasses the real matching logic —
a wrong or missing TXT value in the mock store fails verification exactly like real DNS would.

### Storefront resolution — additive, no competing context

`GET /restaurants/by-domain/:hostname` (public, unauthenticated) mirrors `by-slug` exactly: same
response shape (`{restaurant, availability, supportIdentity}`), same public trust model. Only an
active mapping resolves; pending, verified-but-inactive, removed, unknown hostnames, and a suspended
location or business all 404 identically, never falling through to any other restaurant. The
hostname is asserted by the **client** (`window.location.hostname` — the actual, unspoofable address
bar), not read from a trusted `Host` header — this endpoint has the identical threat model as
`by-slug/:slug` today: anyone can probe any hostname and get that restaurant's already-public data,
which is not a vulnerability, it's how a public storefront works. The property that actually matters
(nobody can make real customers land on a hostname resolving to the wrong business) is guaranteed by
DNS ownership verification, not by anything checked in this handler.

`RestaurantContext.tsx` gained a second resolution path, additive to the Phase 8 slug-based one it
already had: on a bare storefront-shaped route (`/`, `/cart`, `/t/:tableToken`, `/loyalty` —
detected directly against `window.location.pathname`, not "any non-slug route," to avoid a wasted
lookup on `/login`/`/account`/`/support`) where no `/r/:slug` segment matched, it now attempts
`GET /restaurants/by-domain/${window.location.hostname}` before falling back to the existing
`VITE_RESTAURANT_SLUG` legacy redirect. `App.tsx`'s `LegacyRedirect` became resolution-aware: while
loading, render nothing; if domain resolution succeeded, render the real target page (`MenuPage`/
`CartPage`/`LoyaltyPage`) **directly, with no redirect** — the whole point of white-labeling is that
`/r/:slug` never appears in the address bar; if it failed, fall through to exactly the pre-Phase-22
redirect-to-`VITE_RESTAURANT_SLUG` behavior, completely unchanged. Every existing `useRestaurant()`
consumer (`MenuPage`, `CartPage`, `LoyaltyPage`) needed zero changes — the exact Phase 8 precedent
repeating itself.

**`TableContext.tsx` needed the identical dual-mode fix.** It only matched
`/r/:restaurantSlug/t/:tableToken` — on a domain-resolved bare `/t/:tableToken` route it would never
have fired, silently losing dine-in/QR context for any custom-domain QR code. Fixed by adding a
second `useMatch("/t/:tableToken")` alongside the existing one, exactly mirroring
`RestaurantContext`'s own two-match pattern. Caught during implementation, not after — see Bugs
Found.

### SEO / canonical URL

When resolved via an active custom domain, that domain **becomes canonical** — `MenuPage.tsx`'s
canonical `<link>` and JSON-LD `url` switch from `${origin}/r/${slug}` to bare `${origin}`. The
platform's `/r/:slug` URL is deliberately **not** forced into a redirect while a custom domain is
active — an owner may still want existing printed QR codes/links to keep working — so it simply
stops being the canonical one. The partial-unique-active-index (at most one active domain per
location) keeps this unambiguous: there is never a multi-canonical case to resolve.

### Cache

No new cache tier. `by-domain` and `by-slug` both resolve `Restaurant` docs directly (no Redis
layer, matching `by-slug`'s existing "cheap enough, premature to cache" reasoning). The menu cache
key (`menu:{restaurantId}:available`) is keyed by the already-resolved `restaurantId`, so it's
identically correct and identically isolated regardless of which resolution path produced that id —
domain-vs-slug resolution happens strictly before any cache lookup, never inside one.

### Host-header trust — narrower than it might sound

`apps/web` is a pure client-side SPA (no SSR — see this doc's own earlier "Known SEO limitation"
section). The **only** place server-side `Host`-header trust would matter at all is a
per-domain-aware `sitemap.xml` — a raw XML response with no client JS to assert anything — and that
was **not built this phase**: `GET /sitemap.xml` is unchanged, still emitting `/r/:slug` URLs only.
Everywhere else (storefront bootstrap, cart, checkout, order creation), the **client** asserts its
own hostname to a public, unauthenticated, already-public-data-only endpoint — there is no `trust
proxy` setting, and nothing in this phase reads `req.headers.host` or `X-Forwarded-Host` anywhere.
Building per-domain sitemap generation, if ever needed, would be the one place that trust boundary
question has to be answered for real (see Remaining Limitations).

### Backend write/read API

```
GET  /businesses/:businessId/domains                                   requireBusinessMatch + restaurant.settings.manage
POST /restaurants/:restaurantId/domains                                requireTenantMatch + restaurant.settings.manage
POST /restaurants/:restaurantId/domains/:id/check-verification         same
POST /restaurants/:restaurantId/domains/:id/activate                   same
POST /restaurants/:restaurantId/domains/:id/deactivate                 same
DELETE /restaurants/:restaurantId/domains/:id                          same
GET  /restaurants/by-domain/:hostname                                  public, unauthenticated
```

`restaurant.settings.manage` — the same owner-only permission that already gates
branding/currency/hours in `SettingsPage.tsx` — is reused rather than inventing a new RBAC entry;
managing which domain fronts a location's storefront is the same "who controls this storefront's
identity" boundary. Since that permission is owner-only (not manager) today, domain management is
owner-only by direct inheritance, matching the brief's own "authorized manager only if existing
permissions justify it" language — they don't, so managers get 403, same as staff.

`platform_admin` gets no write access to domains at all (consistent with never holding any
`restaurant.*` permission) — instead, `GET /platform/restaurants/:id`
(`getPlatformRestaurantDetail`) gained a read-only `domains` field (verification token stripped),
mirroring the exact precedent Phase 19 set for `businessLocationCount` — light-touch investigative
visibility for support purposes, no new management surface.

### Admin UI

`SettingsPage.tsx`'s previously-static "Domain" tab placeholder is now a real, self-contained
component, `DomainSettingsPanel.tsx` — its own state and API calls, not wired into
`SettingsPage`'s shared form/PATCH (a domain has its own lifecycle, closer to `StaffPage.tsx`'s
list+status-badge+action-button pattern than to a form field). Shows the always-active platform URL,
then one card per domain with a status badge (pending/verified/active), DNS TXT instructions with a
copy-to-clipboard affordance (new to this app — `navigator.clipboard.writeText`, with a silent
no-op fallback if permission is denied) while pending, and the relevant next action
(check verification / activate / deactivate / remove) per status. Deliberately renders with **no
inner `<form>` element** — it's mounted inside `SettingsPage`'s own outer `<form>`, and nested
`<form>`s are invalid HTML; "Add a custom domain" uses a plain input plus an explicit button click
instead of form submission.

### What was NOT built this phase (explicitly deferred)

- Removing/redirecting `/r/:slug` when a custom domain is active — both stay live simultaneously by
  design (see SEO above).
- Per-domain `sitemap.xml` generation — the one place real `Host`-header trust would need to be
  designed for; not attempted without a concrete need driving the trust-boundary decision.
- Any Business-level branding surface, secondary/accent colors, a theme engine, or a hero editor —
  `SettingsPage.tsx`'s existing `ComingSoon` note for the Storefront tab is unaffected and still
  accurate; this phase's branding work was limited to confirming the existing OG/JSON-LD block
  already reads restaurant-level fields only (it did — no change needed).
- Agency/multi-business accounts, a public API, POS integrations, business-wide analytics/
  promotions/billing — all explicitly out of scope per the brief, unaffected by anything here.

### Infrastructure — what production actually requires (not exercised locally)

This phase's application code was verified end-to-end against the **mock** DNS provider and the
local dev reverse-proxy setup already established for this repo (Vite's dev proxy forwarding `/api`
to the API origin). None of the following were exercised against real infrastructure, and none
should be assumed working until they are:
- **Real DNS TXT propagation** — `DNS_VERIFIER=node`'s `dns.promises.resolveTxt` path is real,
  network-capable code, but was never run against a domain this deployment doesn't control.
- **Wildcard/per-domain routing at the reverse-proxy/CDN layer** — production needs *some* mechanism
  routing an arbitrary verified custom domain's traffic (both static assets and `/api/v1/*`) to this
  same backend. This phase's "no CORS/cookie problem" conclusion depends entirely on that topology
  being real; if a custom domain is ever pointed at a *different* origin than the API, the relative-
  fetch/same-origin-cookie assumption breaks and would need real cross-site cookie handling.
- **TLS/certificate provisioning** for each verified custom domain — a hosting/ops concern (e.g. a
  provider's automatic-certificate API), not application code, and entirely unbuilt here.
- **A trusted-host / `trust proxy` decision**, only if per-domain sitemap generation (or any other
  future server-rendered, host-aware response) is ever built.

## Phase 23 — Business-Wide Analytics & Promotions

Phases 18-22 built a real Business → Location architecture, but every cross-cutting capability
(analytics, promotions) stayed strictly single-location. Phase 23 adds a genuine business-wide
layer on top — without touching the mature, working location-level systems underneath, which are
completely unchanged.

### Currency safety — the central constraint

No FX-conversion infrastructure exists anywhere in this codebase (confirmed by reconnaissance
before writing any code — a grep for `exchangeRate`/`conversion`/`forex` across the whole repo
returns nothing real), and building one was explicitly out of scope for this phase. That leaves
exactly one safe design: **monetary business-wide metrics are grouped by currency, never summed
across currencies.** `BusinessAnalyticsOverview.revenueByCurrency`/`averageOrderValueByCurrency`
are arrays of `{currency, amount}`, never a single blended number. Order-count metrics
(`totalOrders`, orders-by-location) need no currency and are safely combined across every location
regardless. A single-currency business (the common case) sees this collapse naturally to one array
entry — no special-cased UI branch needed for that case.

### Timezone safety

Per-location "today"/"this week" (the existing `analytics.service.ts`, unchanged) was already
timezone-correct. At the **business** level, "today" has no single well-defined meaning across
locations in different timezones — rather than picking an arbitrary anchor-location convention
that could silently mismatch what an owner sees on any individual location's own page, business
analytics use an **explicit calendar date range** (`from`/`to`, default last 7 days) instead of
relative labels. Each location's contribution to that range is computed using that location's own
timezone (`getRestaurantAnalyticsForRange`/`getDailyTimeSeries`, both already timezone-aware), then
combined — never a single shared UTC boundary applied to every location.

### Business analytics — architecture

New, narrow functions in `apps/api/src/services/analytics.service.ts` — `getRestaurantAnalyticsForRange`
(totals for an arbitrary date range, one location) and `getTopSellingItemsForRange` (a higher
per-location limit than the existing today/this-week `topSellingItems`, since business-wide product
ranking re-ranks across every location's own top items afterward, and asking each location for only
its own top 5 risks undercounting an item that's consistently popular everywhere but never anyone's
single top-5). Deliberately **new** functions, not a generalization of the existing
`getRestaurantAnalytics` — that function's today/this-week semantics stay byte-for-byte unchanged
for the single-location dashboard.

`apps/api/src/services/businessAnalytics.service.ts` (new) fans out to these once per location under
a business (`Restaurant.find({businessId})`, the same "resolve every location, then fan out" shape
already established by Phase 22's `invalidateMenuCacheForBusiness` and business-domain list) via
`Promise.all` — a bounded, small fan-out matching a business's actual location count, not an N+1
antipattern; `Order` has no `businessId` field to aggregate against directly, and no location's day
boundary can be computed correctly without that location's own timezone, so a single cross-restaurant
mega-aggregation couldn't be both correct and simple. Combines in JS: `totalOrders` (summed),
`revenueByCurrency`/`averageOrderValueByCurrency` (grouped — the latter recomputed from
currency-grouped revenue and paid-order-count totals, never an average of already-averaged
per-location AOVs, which would silently misweight a small location the same as a large one),
`byLocation` (per-location breakdown), day-bucketed `trends` (currency-grouped), and business-wide
`topSellingItems` (grouped by `menuItemId` — accurate for a canonical, Phase-21-migrated shared-menu
business, where the same item genuinely shares one id everywhere; a location still on the legacy
per-location menu path won't have its items merged into a same-named canonical item elsewhere, a
documented minor limitation).

**API** (`/businesses/:businessId/analytics/{overview,trends,products}?from=&to=&locationIds=`):
`requireBusinessMatch()` + the existing `restaurant.analytics.read` permission (already owner+manager,
not staff/kitchen_staff) — no new RBAC entry. An optional `locationIds` filter is validated against
the business's own `Restaurant.find({businessId})` set server-side; a requested id that doesn't
belong to this business is silently dropped, never trusted to expand scope — the one place a
client-supplied filter could otherwise leak cross-business data. `platform_admin` gets no route here
(consistent with the Phase 22 domain-management decision) — investigative visibility, if ever needed,
would extend the existing `/platform/restaurants/:id` endpoint, not this one.

**Frontend**: `BusinessAnalyticsPage.tsx`, shown only when a business has more than one location
(`Layout.tsx`'s new `multiLocationOnly` nav-item flag) — a single-location owner's one location
already *is* the business, so the existing per-location `AnalyticsPage.tsx` remains untouched and
sufficient. A date-range picker, one metric card per currency (never blended), a location-comparison
table, a trend chart with a per-currency selector, and business-wide top products.

### Business-wide promotions — architecture

`Promotion` gained additive fields: `businessId?` (ref Business, indexed) and `locationIds?`
(ref Restaurant, the selected subset) — a promotion is EITHER location-scoped (`restaurantId` set,
the original shape, completely unchanged) OR business-scoped (`businessId` + non-empty `locationIds`,
`restaurantId` unset). `restaurantId`'s requiredness became conditional
(`required: function(){return !this.businessId}`), mirroring the exact Phase 21 `Category`/`MenuItem`
precedent.

**Two partial unique indexes** replace the single original one (mirroring `Payment.ts`'s established
multi-partial-index pattern and Phase 22's `DomainMapping` precedent):
- `{restaurantId, code}` unique, `partialFilterExpression: {restaurantId: {$exists: true}}` —
  unchanged behavior for every existing location promotion.
- `{businessId, code}` unique, `partialFilterExpression: {businessId: {$exists: true}}` — new;
  prevents code reuse within one business's own business promotions, while different businesses
  freely reuse the same code (matching how different restaurants' location promotions already could).

Changing an index's *options* (adding a partial filter) does **not** get picked up automatically by
Mongoose against an existing database — the old, differently-configured index with the same name
keeps running until explicitly dropped and recreated (`collection.dropIndex`/`createIndex`, or
`Model.syncIndexes()`). This was hit directly during this phase's own testing (a stale
non-partial `restaurantId_1_code_1` index caused a real `E11000` collision between two *different*
businesses' promotions, both correctly having `restaurantId: undefined`) and fixed for this dev
database — **a real deployment migrating this schema change needs the same explicit index sync
before the new partial-filtered uniqueness guarantee actually holds**, not just a code deploy.

**`validatePromoCode(restaurantId, code, subtotal, businessId?)`** — the `businessId` parameter
(new, optional; the order's own already-loaded `restaurant.businessId`, so no extra query at the
one real call site) makes the lookup resolve BOTH a location promotion (`restaurantId` matches
directly, unchanged) AND a business promotion (`businessId` matches **and** `locationIds` contains
this *specific* `restaurantId` — an exact membership check, never "any location of the same
business"). `recordPromoUsage` (the atomic conditional-`$inc` usage-limit guard) is **unchanged** —
already keyed by the promotion's own `_id`, it works identically and safely for both scopes,
including under concurrent redemption at two *different* locations of the same business promotion.

**Conflict/precedence rules — explicit, not silently chosen:**
- One promo code per order, unchanged — `createOrderSchema.promoCode` was always a single optional
  string, never an array; this phase does not introduce multi-code stacking.
- A business promotion and a location promotion at the same location never structurally conflict —
  each code resolves to exactly one `Promotion` (mutually exclusive by the index design above); a
  customer picks one code, never both. There is nothing to arbitrate.
- A location removed from `locationIds` stops resolving there on the very next validation call (a
  live lookup, never cached) — no special-case code needed.
- A suspended location already 404s before promo validation is ever reached (`createOrder`'s
  existing `Restaurant.findOne({_id, status:"active"})`) — falls out of existing behavior.
- Editing a promotion after orders exist never retroactively changes those orders — `Order` already
  stores an immutable discount snapshot at creation time, never live-linked to the `Promotion`
  document. Confirmed unchanged, not new work.

**API** (`/businesses/:businessId/promotions`, same `requireBusinessMatch()` +
`restaurant.promotions.manage` pattern as categories/menu/domains): list/create/update/delete. Every
submitted `locationIds` entry is validated server-side to actually belong to this business
(`Restaurant.countDocuments`) — a foreign id is **rejected** (400), not silently dropped, unlike the
analytics read-side filter: creating a promotion is a write, and an owner who genuinely selected 3
locations but silently got 2 saved would be a real, confusing gap.

The existing `/restaurants/:restaurantId/promotions` **list** endpoint is extended (create/
update/delete for location promotions are completely unchanged) to also return any business
promotion whose `locationIds` include this restaurant, tagged `scope: "business"` alongside this
location's own `scope: "location"` rows — a location admin sees everything actually affecting their
storefront, not just what they personally own. Editing a business promotion is only ever possible
from the business-level page — the location-scoped PATCH/DELETE routes filter by `{_id, restaurantId}`,
which a business-promotion document (no `restaurantId`) can never match, so this exclusion falls out
of the existing query shape rather than needing an explicit check.

**Audit logging** (new — promotions previously wrote none at all, a real pre-existing gap closed
alongside this phase's new business-promotion logging): new `AuditLog` target type `"promotion"` and
actions `promotion.created`/`updated`/`activated`/`deactivated`/`deleted`. A business promotion's
audit event fans out **one entry per targeted location** (not a single business-scoped entry) so
each location's own admin sees it in their own existing audit log view — the same
`GET /restaurants/:restaurantId/audit-log` that already exists, unchanged.

### Admin UX

`BusinessPromotionsPage.tsx` (new, shown only when multi-location) follows `PromotionsPage.tsx`'s
existing list/create/toggle/delete pattern plus a location checkbox multi-select against the
business's own fetched location list — never free text. `PromotionsPage.tsx` itself gained one
small addition: business promotions applicable to the active location render read-only, tagged
"Business-wide," with "Manage from Business Promotions" instead of edit controls.

### What was NOT built this phase (explicitly deferred)

- A public API, POS integrations, AI features, driver/inventory/staff-scheduling management, native
  apps, a full BI/reporting platform, agency/multi-business accounts, SaaS billing — all explicitly
  out of scope per the brief.
- Real FX conversion — the currency-grouping design above is the permanent shape for this phase, not
  a stopgap; building real conversion would be a deliberate, separate future decision, not an
  oversight here.
- `platform_admin` business-analytics visibility — not built; the existing
  `/platform/restaurants/:id` endpoint remains the investigative surface for platform admins, and
  extending it to business-wide analytics was not requested this phase.
- Per-domain sitemap / any interaction between custom domains (Phase 22) and business-wide
  analytics/promotions — the two features are independent; a custom domain still resolves to exactly
  one location, and that location's orders/promotions are counted through the same
  `restaurantId`-scoped path regardless of which domain a customer used to place them.

## Phase 24 — Billing & Subscription Architecture

Phase 24 builds the platform's own commercial billing/subscription **foundation** — a
provider-agnostic domain model, lifecycle state machine, entitlement mechanism, and minimal owner-
facing UX. It is explicitly **not** a real billing provider integration: no real prices are invented,
no live credentials exist, and nothing in this phase gates any existing feature. This is a different
financial domain from the existing customer-order `PaymentProvider`/`Payment` system (Phase 15) and
is deliberately kept separate from it end to end.

### Reconnaissance findings that shaped the design

- No trial/plan/tier/subscription field existed anywhere before this phase — confirmed by full reads
  of `Business.ts`/`Restaurant.ts` and a repo-wide grep. `Business` has exactly one `ownerId` (a
  single required `User` ref); `User` has exactly one optional `businessId`. No `agencyId` exists
  anywhere except a reserved, documented-as-unused field on `SupportTicket` — confirming there is no
  Agency entity to build against yet (deferred to Phase 25).
- `requireBusinessMatch()`/`requireTenantMatch()` are the only authorization primitives above
  location scope, both keyed off `req.user.businessId` — there is no "above Business" concept.
- `req.user` is populated directly from JWT claims with **no per-request DB read**
  (`middleware/auth.ts`); claims are only re-derived at login/refresh. This independently confirms
  the design conclusion below: subscription/entitlement status must never be embedded in a JWT claim
  — it has to be checked live from the DB on every subscription-sensitive request, the same way every
  other permission already is.
- `PaymentProvider`/`MockPaymentProvider`/`PaymentWebhookEvent`/`payment.service.ts`'s
  `processProviderEvent` and `refundPayment` are the exact, directly-mirrorable precedent for
  provider abstraction, webhook idempotency, and atomic state-transition guarding — reused here as a
  pattern, never as shared code, since payments and billing are different financial domains with
  different lifecycles and different idempotency stores.

### Core architectural decision — Subscription ownership

A `Subscription` attaches to a polymorphic `{ownerType: "business" | "agency", ownerId}` pair, never
directly to `Restaurant`/Location and never hard-coded to `Business` either. Today only
`ownerType: "business"` is reachable through any real code path — no `Agency` collection exists to
point `ownerType: "agency"` at yet. This is the one design choice that simultaneously satisfies every
constraint the brief lists (never assumes one subscription = one restaurant/location; never bakes
agency assumptions into `User.businessId`; stays structurally compatible with a future Agency entity)
without speculatively building Agency membership now. **Phase 25 only needs to add the `Agency`
model and start creating `ownerType: "agency"` subscriptions through this same, unchanged
Subscription/lifecycle/entitlement code** — nothing here needs to change to support it.

`Plan.type` (`"OWNER" | "AGENCY"`, the commercial tier) is a separate field from `Subscription.ownerType`
(the structural pointer to who holds it) — they correlate in practice but are independently evolvable.

### Domain model

**`Plan`** (`apps/api/src/models/Plan.ts`) — a small, mostly-static catalog: `code` (unique), `name`,
`type`, `pricing[]` (`{interval, amountCents?, currency?}` — `amountCents`/`currency` deliberately
**absent** on every seeded entry; no real commercial pricing has been decided, and this is documented
in-code as a pending business decision, never an invented number), `entitlements[]`
(`{key, value: boolean|number|string}`), `isActive`.

**`Subscription`** (`apps/api/src/models/Subscription.ts`) — `ownerType`, `ownerId`, `planId`,
`status` (six states, see below), `billingInterval`, `currentPeriodStart`/`currentPeriodEnd`,
`trialStart`/`trialEnd`, `cancelAt`/`cancelledAt`, `provider` (`"mock" | "internal"` —
`"internal"` marks a platform-granted subscription with no real payment relationship: grandfathered
pre-existing businesses, future comps — explicit and auditable, never a silent bypass),
`providerCustomerId`/`providerSubscriptionId`. Two indexes:
- `{ownerType, ownerId}` unique, partial on `status IN [trialing, active, past_due, cancelling]` — at
  most one **live** subscription per owner at the DB level (mirrors `DomainMapping`'s "one active
  domain per location" pattern). A cancelled/expired subscription is never deleted (financial
  history, matching `Payment`/`Refund`'s convention); re-subscribing creates a **new** document,
  never resurrecting the old one.
- `{provider, providerSubscriptionId}` unique, partial on `providerSubscriptionId` being a string —
  mirrors `Payment.ts`'s `{provider, providerRef}` pattern exactly: a real external subscription id
  must never map to two different `Subscription` documents.

**`BillingWebhookEvent`** — byte-for-byte the same shape as `PaymentWebhookEvent`
(`provider, eventId, eventType, payload, processedAt, processingError`, unique `{provider, eventId}`),
deliberately a **separate collection**, even though the shape is identical — financial domains stay
unmixed.

### Lifecycle state machine

Six states, each serving a distinct purpose: `trialing, active, past_due, cancelling, cancelled,
expired`. `expired` ("trial ended without converting") is kept distinct from `cancelled` ("a paid
subscription was actually cancelled") since they mean different things to an owner and to future
analytics. Valid transitions (`subscriptionStateMachine.ts`, enforced everywhere `status` is ever
set — no raw `$set` on it anywhere else):

```
trialing   → active, cancelled, expired
active     → cancelling, past_due, cancelled
past_due   → active, cancelled
cancelling → cancelled, active        // "active" = un-cancel before period end
cancelled  → (terminal)
expired    → (terminal)
```

**Cancellation is state-dependent, not one-size-fits-all**: only `active` supports the scheduled
"stays usable until period end" path (`active → cancelling`) — a `trialing` subscription has never
been charged and a `past_due` one has already failed to bill, so cancelling either of those is
**immediate** (`→ cancelled` directly), regardless of the caller's `atPeriodEnd` intent; there is no
paid period to let the customer keep using. Cancelling an already-`cancelling` subscription is
rejected outright (it's already scheduled) rather than silently escalating to an immediate cancel.

A provider-reported `"cancelled"` while our side is still `"trialing"` always maps to our
`"expired"` — an involuntary trial expiry. A user-initiated cancel *during* a trial never goes
through a webhook at all; it's the owner's direct `cancelSubscription()` call, applied immediately.

### Billing provider abstraction

Mirrors `apps/api/src/payments/` exactly, in a new, separate `apps/api/src/billing/` directory:
`BillingProvider.ts` (interface: `createCustomer`, `createSubscription`, `retrieveSubscription`,
`cancelSubscription`, `changePlan`, `verifyWebhookSignature`), `MockBillingProvider.ts` (real,
deterministic in-memory implementation with a genuine HMAC-SHA256 `verifyWebhookSignature` — the
only adapter that runs today), `index.ts` (`getBillingProvider()` lazy singleton, selected by
`BILLING_PROVIDER` env var — `"mock"` is the only valid value this phase; the enum has no second
option yet rather than a placeholder that would silently no-op if selected). No real provider stub
file exists — a stub with no real code behind it would overstate what's done.

The provider's own status vocabulary (`trialing|active|past_due|cancelled`) is deliberately smaller
than our six-state `SubscriptionStatus` — `cancelling`/`expired` are business-side interpretations
layered on top of what a provider actually reports, not states a provider itself needs to track.

### Webhook / idempotency

`POST /webhooks/billing/:provider` — top-level, not nested under `/businesses`, mirroring
`/webhooks/payments/:provider` exactly: authenticated by signature, not a session, so no
`requireAuth`. `processBillingProviderEvent` (`subscription.service.ts`) mirrors
`processProviderEvent` exactly: `BillingWebhookEvent.create(...)` first as the atomic dedup check
(duplicate key → already handled, return early) → look up `Subscription` by
`{provider, providerSubscriptionId}` → resolve the target status → validate via
`isValidSubscriptionTransition` (invalid → log + record `processingError`, never throw) → atomic
`findOneAndUpdate({_id, status: {$ne: to}})` guard → mark `processedAt`. Unlike the payment webhook
handler (which needs a transaction because it writes to two related documents, `Payment` and
`Order`), this only ever writes one document, so a plain atomic guard is sufficient — closer to
`refundPayment`'s single-document "reserve-then-call" shape.

A **dev/test-only** driver, `POST /businesses/:businessId/subscription/mock-advance`
(`billingMockDriver.controller.ts`, mounted only when `BILLING_PROVIDER=mock`), drives a real,
self-signed event through this exact same path — the billing equivalent of the existing
`payment.routes.ts` `mock-complete` endpoint. It is not a shortcut around signature verification; it
signs its own payload and verifies it before processing, exactly as a genuine webhook delivery would.

### Concurrency

- **Duplicate webhook delivery**: closed by `BillingWebhookEvent`'s unique index.
- **Same event processed twice / two simultaneous deliveries of the same event**: closed by the
  `status: {$ne: to}` guard on the subscription update.
- **Concurrent subscription-creation attempts for the same owner**: closed by the
  `{ownerType, ownerId}` partial unique index — the loser's insert fails with a duplicate-key error,
  caught and translated to a clean 409 (verified under true `Promise.all` concurrency in tests).
- **Activation and cancellation arriving close together**: whichever transition the DB accepts first
  wins; the loser is validated against the subscription's now-current status, so an out-of-order pair
  either applies cleanly in whichever order actually lands, or is rejected as invalid from the state
  that won — never silently corrupts state.

### Entitlements

`apps/api/src/services/entitlement.service.ts` — `getEntitlements(plan)` and `hasEntitlement(plan, key)`,
plan-level only (no per-subscription override layer this phase). A boolean entitlement is
present-and-true; a numeric one is present-and-positive (a limit of `0` means "not entitled," not
"unlimited" — there is no unlimited sentinel); an absent key is always `false` — no implicit
default-allow. Seeded with a small, honestly-justified starter set tied to features that already
exist and are already business-scoped (`custom_domains`, `business_analytics`,
`business_promotions`) — real, checkable keys with real values, but **deliberately not wired into
any existing route's authorization chain this phase**, per the explicit instruction not to
prematurely gate features that already work. Custom domains, business analytics, and business
promotions all keep working exactly as before, completely ungated.

### Migration / backward compatibility

Every business created before this phase has **no** `Subscription` document at all — absence, not a
wrong status. No existing route checks subscription state, so this was already safe as-is.
`apps/api/src/scripts/backfillSubscriptions.ts` (`--dry-run` supported; logic in the importable
`subscriptionBackfill.service.ts`) creates one `active`, `provider: "internal"` (grandfathered, no
real billing relationship), `owner`-plan `Subscription` per business that has **zero** `Subscription`
documents at all (live or historical) — naturally idempotent, a business with any subscription
document is always skipped. `currentPeriodEnd` is set 100 years out and documented in-code as
"grandfathered, not a real billing period," never left ambiguous. Run for real against the dev
database (dry-run inspected first): 323 pre-existing businesses grandfathered, re-run confirmed a
no-op.

### API surface

```
GET  /businesses/:businessId/subscription                 billing.read  (owner+manager)
POST /businesses/:businessId/subscription                 billing.manage (owner-only) — start (mock)
POST /businesses/:businessId/subscription/cancel           billing.manage
POST /businesses/:businessId/subscription/reactivate       billing.manage
POST /businesses/:businessId/subscription/change-plan      billing.manage
GET  /businesses/:businessId/subscription/entitlements     billing.read
POST /businesses/:businessId/subscription/mock-advance     billing.manage — dev/test only, BILLING_PROVIDER=mock
POST /webhooks/billing/:provider                           public, signature-verified only
GET  /plans                                                 any authenticated user (read-only catalog)
GET  /platform/subscriptions                                platform.restaurants.manage — read-only overview
```

No subscription id appears in the lifecycle URLs — a business has at most one live subscription (DB-
enforced), so actions are addressed by `businessId` alone. Two new permissions, `billing.read`
(owner + manager) and `billing.manage` (owner-only) — a dedicated pair rather than reusing
`restaurant.settings.manage`, since billing is a higher-sensitivity domain where a manager plausibly
should see status without being able to change it. `platform_admin` gets read-only visibility only
(`GET /platform/subscriptions`, and a `subscription` field on the existing
`GET /platform/restaurants/:id`, provider ids stripped) — no write access to any business's billing.

### Audit logging

New `AuditLog` target type `"subscription"` and actions `subscription.created`/`plan_changed`/
`cancellation_requested`/`reactivated`/`cancelled` — human-initiated actions only. Webhook-driven
status changes are **not** audited: `AuditLog.actorUserId` is a required field with no clean human
actor for a system/provider-driven event, matching the existing precedent (`payment.service.ts`'s
`processProviderEvent` doesn't call `recordAuditEvent` either, for the same reason). Since `AuditLog`
stays `restaurantId`-scoped, a business-level billing event fans out one entry per `Restaurant` under
the business — the same helper shape Phase 23 established for business-wide promotions.

### Admin UX

**Owner-facing**: `BillingPage.tsx` (`/billing`), never `multiLocationOnly` — every business has
exactly one subscription regardless of location count, unlike Analytics/Promotions. Shows plan,
status, trial/period dates, cancel/reactivate actions, and (mock-only) a "Start subscription" action
when none exists, plus a labeled dev-only "Simulate trial conversion" button.

**Platform-admin**: `PlatformSubscriptionsPage.tsx` replaces the earlier `/platform/subscriptions`
placeholder stub with a real, read-only, paginated list (business, plan, status, period, provider) —
no administrative actions.

### What was deliberately deferred (explicit non-goals, per the brief)

- Agency membership architecture, real POS/public API/AI/WhatsApp/SMS features, advanced CRM/loyalty,
  final branding — all out of scope, unchanged from prior phases' non-goals.
- A real billing provider integration — `MockBillingProvider` is the only adapter that runs; a real
  one would implement the same `BillingProvider` interface, with `SafepayProvider.ts` as the
  precedent for the verification a real financial adapter needs before it can be trusted.
- Any real commercial pricing decision — `Plan.pricing` stays structurally ready but empty.
- Wiring entitlements into any existing route's authorization — the mechanism is real and tested on
  its own, not yet load-bearing anywhere.
- Speculative usage limits, self-serve plan-comparison/pricing pages, invoicing/receipts.

### Commercial decisions still required (explicitly not made by this phase)

- Actual prices for `owner`/`agency` plans, in which currencies.
- Final trial length (currently a configuration default, `TRIAL_PERIOD_DAYS=14`, not a commercial
  decision).
- Which real billing provider to integrate, and when.
- Whether/how existing grandfathered (`provider: "internal"`) businesses ever transition onto a real
  paid plan.

## Phase 25 — Agency Architecture, Multi-Business Management

Phase 24 built `Subscription.ownerType: "business" | "agency"` and `Plan.type: "OWNER" | "AGENCY"` as
a forward-compatible slot, explicitly deferring the Agency entity itself. Phase 25 builds the real
thing: `Agency → Business → Location`, with an agency able to manage multiple businesses, invite the
people who run them, and switch between agencies — all without weakening the tenant isolation the
last eight phases established. This is a foundation phase: no real billing provider, no final
pricing, no launch-readiness claim, and — per its own explicit boundary — no deep operational access
into a managed business's day-to-day running (orders, kitchen, menu editing). See Section 33 below
for an honest, direct answer to every question the brief asked this phase to answer.

### Reconnaissance findings that shaped the design (verified via 3 parallel Explore agents)

- `User.businessId` is a singular ref, read directly at 8+ call sites, with **zero DB read per
  request** — `requireAuth` copies JWT claims onto `req.user` directly, re-derived only at
  login/refresh. `Business.ownerId` is a required singular ref to `User`. No agency field existed
  anywhere before this phase except the two Phase-24 hooks and an unused, unreferenced
  `SupportTicket.agencyId`.
- The codebase's own established pattern for "one user, multiple scoped things" is `User.locationIds`
  — an array claim embedded in the JWT, refreshed at login. `restaurant_staff`/`kitchen_staff` need
  explicit array membership; `restaurant_owner`/`restaurant_manager` get *implicit* access to every
  location under their `businessId` via one DB read in `canAccessRestaurant`. This is the exact shape
  mirrored for agency membership below.
- `requireBusinessMatch()` is a 12-line function used identically by all eight
  `/businesses/:businessId/...` routers. One well-contained extension to it — not eight per-route
  rewrites — is what makes every existing business-scoped route agency-aware.
- `subscription.service.ts`'s five functions were hard-coded to `ownerType: "business"` and
  business-specific lookups; `entitlement.service.ts`/`subscriptionStateMachine.ts` were already
  ownerType-agnostic.
- `AuditLog.restaurantId` is required — structurally unable to represent agency-only events (agency
  created, member invited) that have no restaurant in scope yet. Mirrors the exact reasoning Phase 24
  used to keep `BillingWebhookEvent` separate from `PaymentWebhookEvent` despite an identical shape.
- The invite/accept-token pattern (`secureToken.service.ts`, `acceptInvite`'s atomic
  double-accept-safe `findOneAndUpdate`) was fully reusable as the direct precedent for agency-member
  invites.

### Core architectural decision — Agency is a new top-level entity, not a Business variant

`Agency {name, slug, description?, logo?, contactEmail, status, businessCount}` — deliberately **no
`ownerId`** field, unlike `Business`. An Agency's ownership *is* its membership (an `agency_owner`
row), not a single ref: `Business` predates membership modeling and keeps its legacy singular owner;
`Agency` is new and has no such baggage to preserve.

`Business.ownerId` stays required and means exactly what it means today: the real business-owner
`User`, invited by the agency or set at creation — completely unchanged for the individual-owner
path. A new, optional `Business.agencyId?` (indexed) marks "which agency manages this business, if
any." Every business created before this phase simply has it unset — a valid, non-migrated state
(mirrors Phase 24's "absence is safe" reasoning for `Subscription`), so **no migration script was
needed this phase**.

### `AgencyMembership` — the explicit join model, never a singular `User.agencyId`

```
AgencyMembership {
  agencyId, userId, role: "agency_owner"|"agency_admin"|"agency_staff",
  status: "invited"|"active"|"revoked"|"deactivated",
  businessIds?: ObjectId[],   // explicit per-business assignment, agency_staff only
  invitedBy?, inviteTokenHash?, inviteExpiresAt?, acceptedAt?,
}
```
Unique `{agencyId, userId}` — one row per user per agency; a user can hold independent-role rows in
multiple agencies, which is exactly why this can't be a singular JWT field the way `businessId` is.
`businessIds` mirrors `User.locationIds` for `restaurant_staff` exactly: `agency_owner`/`agency_admin`
get *implicit* access to every business under the agency; `agency_staff` needs *explicit* membership
in this array (no implicit access — absence means no business access yet, never default-allow).

### JWT gains an `agencyMemberships` array claim

`AccessTokenPayload.agencyMemberships?: Array<{agencyId, role}>`, populated from
`AgencyMembership.find({userId, status:"active"})` at login/refresh only — the same staleness
contract every other claim already has (a new membership or role change takes effect on next
login/refresh, not immediately; the frontend's `AuthContext.refreshUser()` exists specifically to let
a mid-session action like "create an agency" or "accept an invite" get a fresh claim without a full
logout/login).

### `requireBusinessMatch()`'s new branch — the single highest-leverage change in this phase

```
1. platform_admin → allow (unchanged)
2. req.user.businessId === params.businessId → allow (unchanged, zero-DB-read fast path)
3. NEW: if req.user.agencyMemberships is non-empty, ONE DB read — Business.findById(businessId)
   .select("agencyId") — if it matches a membership: agency_owner/agency_admin → allow;
   agency_staff → allow only if membership.businessIds includes this business (one further read).
4. otherwise → deny
```
This one DB read mirrors `canAccessRestaurant`'s existing owner/manager branch precisely — not a new
pattern. Sets `req.agencyRole` on success, consumed by the new `requireBusinessPermission` (swapped
in for `requirePermission` on all eight business-scoped routers only): an agency member's *global*
`role` is `"agency_member"`, which grants nothing in `ROLE_PERMISSIONS` — every real capability flows
through `req.agencyRole` checked against `AGENCY_ROLE_BUSINESS_GRANTS`, a small map expressed in the
*existing* `Permission` vocabulary, limited to exactly the permissions the eight business-scoped
routers actually check (`restaurant.settings.manage`, `billing.read`/`manage`,
`restaurant.promotions.manage`, `restaurant.analytics.read`, `restaurant.menu.read/write`,
`restaurant.categories.write`, `restaurant.modifiers.write`) — nothing location-operational is in it
at all.

### Explicit boundary: business-level access, not location-operational access

Every agency capability the brief lists (create businesses, manage locations list, business
settings, analytics, promotions, domains-read, subscription) is **business-scoped**
(`/businesses/:businessId/...`). Day-to-day location operations (orders, kitchen, tables, delivery,
location staff) remain governed by the *existing*, completely untouched `requireTenantMatch` —
reachable only by the business's own owner/manager/staff. This matches the brief's own invitation-
flow description ("the owner should access their Business normally") and avoids retrofitting
agency-awareness into every location-scoped route in the app. A future phase could extend
`agency_staff` assignment down to `locationIds` using the identical, already-proven mechanism, if
ever needed — this is a considered, documented boundary, not an oversight.

### Agency's own permissions — a separate, small `AgencyPermission` type

Governs `/agencies/:agencyId/...` routes themselves (not businesses they manage):
`agency.manage`, `agency.members.manage`, `agency.businesses.manage`, `agency.billing.read`,
`agency.billing.manage`. GET routes only require `requireAgencyMatch` (any active membership, any
role); these permissions gate mutations only, mirroring `billing.read`/`billing.manage`'s read/write
split. A deliberately separate concern from `AGENCY_ROLE_BUSINESS_GRANTS` above.

### Subscription: generalized core, Phase 24's business functions unchanged as thin wrappers

`subscription.service.ts`'s five functions were refactored into an `{ownerType, ownerId}`-generic
core with `createSubscriptionForBusiness`/`cancelSubscription`/etc. as thin wrappers — zero behavior
change (all 34 existing Phase 24 tests pass unmodified). New `createSubscriptionForAgency`/
`cancelAgencySubscription`/`reactivateAgencySubscription`/`changeAgencySubscriptionPlan` resolve
identity from `Agency.name`/`contactEmail` instead of `Business`/owner `User`. New
`/agencies/:agencyId/subscription` mirrors `businessSubscription.routes.ts` exactly. The existing
`{ownerType, ownerId}` partial unique index already protects against duplicate agency subscriptions
— no new concurrency work needed, just confirmed reuse.

### Entitlements / usage limits — real, checkable, atomic under concurrency

`Plan` (agency-type) entitlements gain `max_businesses` (numeric), seeded with an explicit,
documented-as-non-final development placeholder (`10`) — mirrors Phase 24's `TRIAL_PERIOD_DAYS=14`
precedent exactly. `Agency.businessCount` is a maintained counter, reserved **atomically** via
`Agency.findOneAndUpdate({_id, businessCount:{$lt:max}}, {$inc:{businessCount:1}})` — the same
atomic-guard-not-check-then-insert principle Phase 23/24 already established, verified under true
`Promise.all` concurrency in tests (two simultaneous business-creation requests against a limit of 1
yield exactly one success). A new, narrow `agencyEntitlement.service.ts` keeps this concern distinct
from `entitlement` (what a plan includes) and `billing status` (subscription lifecycle), per the
brief's explicit "do not mix these concepts."

### Agency business creation — mirrors `createRestaurant`'s transactional shape, no impersonation

`createAgencyBusiness` uses the same `mongoose.startSession()`/`withTransaction` pattern as
`restaurant.controller.ts`'s `createRestaurant`: creates an unusable-password owner `User`, a
`Business` (`agencyId` set), the first `Restaurant`, reserves the agency's business-count slot
atomically *before* the transaction (released on any transaction failure, including the genuine race
the pre-checks can't close), sends the existing `ownerInviteEmail` unchanged, and records both a new
`AgencyAuditLog` entry and the existing per-restaurant `AuditLog` entry. The agency never
authenticates *as* the owner — explicit authorization the whole way.

### Agency member invitation — a separate accept flow, own token, not an overload of the existing one

`AgencyMembership` carries its **own** `inviteTokenHash`/`inviteExpiresAt`, distinct from
`User.inviteTokenHash` — a person could plausibly have a pending business-staff invite and an agency
invite at the same time, and conflating the two fields would corrupt one or the other. Inviting an
existing platform account (looked up by email first) touches only the membership row, never the
`User`'s password; inviting a brand-new person reuses the standard unusable-password mechanism.
`POST /agencies/accept-invite` mirrors `acceptInvite`'s exact atomic double-accept protection for
both documents it may touch. Only accounts with role `"customer"` or already `"agency_member"` can be
invited or self-serve-create an agency — mixing a restaurant-scoped or `platform_admin` identity with
agency membership is a real product question deferred, not silently allowed.

### `AgencyAuditLog` — new, small, parallel collection, not a schema change to `AuditLog`

Same shape/"log and swallow, never fail the real operation" conventions as `AuditLog`, scoped to
`agencyId` because agency-only events (agency created, member invited, before any business exists)
have no restaurant to attach to. Business-scoped actions taken by an agency member (business
creation) still *also* write the normal per-restaurant `AuditLog` entry — both trails populated, no
duplication of concern.

### Concurrency — verified under true `Promise.all` in Jest

- **Duplicate business creation against `max_businesses`**: atomic `businessCount` guard, one 201 one
  409, counter never over-incremented.
- **Duplicate agency membership accept (same token)**: atomic double-`findOneAndUpdate` guard (User
  password + AgencyMembership status), one 200 one 400.
- **Duplicate agency subscription creation**: the existing `{ownerType, ownerId}` partial unique
  index, reused unchanged.
- **Cross-agency / cross-business isolation**: proven via real HTTP in Jest (not middleware-unit
  tests) — an agency member of Agency A can never reach Agency B's businesses, members, subscription,
  or audit log, and a business's own real owner (invited by an agency) can access their business but
  never the agency's own administration surface.

### Migration / backward compatibility

None required. `Business.agencyId` is optional and unset by default for every business that existed
before this phase — a valid, non-migrated state, not a wrong one.

### Platform administration

`GET /platform/agencies` (paginated, mirrors `listPlatformSubscriptions`) — business/member counts
per agency, read-only. No write access to any agency's members/businesses/billing through this
surface: `requireAgencyPermission` deliberately does **not** exempt `platform_admin` the way
`requireAgencyMatch`/`requireBusinessMatch` do, so a platform_admin can reach an agency's own GET
routes (consistent read visibility) but never its mutations.

### Admin UX

`AgencyContext.tsx` — the agency-switching analog of `LocationContext.tsx`, same "localStorage is a
UI preference only, never trusted for authorization" philosophy. `AgencyDashboardPage.tsx` (shows a
self-serve create-agency form for an account with none, or a summary + switcher for one/more),
`AgencyBusinessesPage.tsx` (list + create — **read-only-plus-create**, deliberately not wired into
the existing owner-facing Menu/Analytics/Promotions pages; see the boundary decision above),
`AgencyMembersPage.tsx` (invite/role-change/revoke), `AgencyBillingPage.tsx` (mirrors `BillingPage.tsx`
for `/agencies/:agencyId/subscription`, no mock-advance dev button — that driver only exists for
business subscriptions today). A new `RegisterPage.tsx` + `AuthContext.register()` is the admin app's
*only* self-serve signup, and only for starting an agency — every other admin identity is always
invited. `roleHomePath()` is the one shared "role → default landing page" mapping (`platform_admin`→
`/platform`, `agency_member`/`customer` → `/agency`, else → `/`), used by both `LoginPage` and
`RequireAuth` so they can never drift into a redirect loop.

### What was deliberately deferred (explicit non-goals, matching the brief's Section 29-30)

- **Real SaaS billing provider integration and platform payment receiving** — Phase 24's mock-only
  architecture, unchanged and unextended this phase.
- **Final pricing for owner/agency plans** — `max_businesses:10` is a development placeholder, not a
  commercial decision.
- **Deep agency-level cross-business analytics/revenue aggregation** — `GET /agencies/:agencyId/
  businesses` returns per-business summaries (location count, subscription status), never a blended
  rollup; a real aggregation layer (currency-grouped, timezone-safe, on the scale of Phase 23's
  business analytics) is explicitly foundation-only, not attempted.
- **Agency-staff location-level (not just business-level) access** — the mechanism to extend it
  (`AgencyMembership.businessIds`, mirroring `User.locationIds`) already exists; wiring it into
  `requireTenantMatch` does not.
- **Wiring the existing owner-facing admin pages (Menu, Orders, Analytics, Promotions, Domains) into
  an "acting as agency for business X" context** — the API is agency-aware for every business-scoped
  route already; the admin frontend's operational pages are not, and extending `LocationContext`/
  business-selection to support this is a real, separate piece of work.
- Socket.IO agency rooms, real notification dispatch (the existing BullMQ queue/job-name-union
  pattern is the integration point, no new sender built), public API, POS, AI features — all
  unchanged from prior phases' non-goals.

### Section 33 — honest, direct answers

1. Can one agency exist? **Yes**, self-serve, real, tested.
2. Can an agency have multiple members? **Yes** — `AgencyMembership`, tested with 3 roles.
3. Can an agency create multiple businesses? **Yes**, up to its plan's `max_businesses` (or a
   development-placeholder default of 3 with no subscription), atomically enforced.
4. Can each business have multiple locations? **Yes** — unchanged from Phase 18/19, untouched.
5. Can each business have its own owner? **Yes** — the agency-created flow invites a real
   `restaurant_owner`, structurally identical to the platform-admin-created path.
6. Can agency users switch between businesses? **Partially** — they see and can act on every managed
   business's *business-level* surface (settings/analytics/promotions/billing) via the API today; the
   admin UI's switcher for this is deferred (see above). They cannot yet switch into a business's
   day-to-day operational admin (Menu/Orders/Kitchen) — that boundary is intentional this phase.
7. Can they then switch between locations? **Not yet** — a direct consequence of #6; the mechanism
   (`AgencyMembership.businessIds` → `requireTenantMatch`) is not wired.
8. Is every authorization boundary enforced server-side? **Yes** — proven via real HTTP tests, not
   middleware-unit tests; localStorage/JWT claims are never trusted as sole authorization, every
   agency/business access re-verifies against the DB.
9. Can a business owner access only their own business? **Yes**, unchanged and re-verified.
10. Can location staff access only their assigned locations? **Yes**, unchanged — `requireTenantMatch`
    was not touched by this phase, and the existing regression suite proves it still isn't.
11. Can agency members be restricted appropriately? **Yes** — `agency_staff` needs explicit
    `businessIds` assignment; `agency_owner`/`agency_admin` get implicit full access, mirroring the
    proven `restaurant_staff`/owner-manager split.
12. Can agency subscriptions exist through the Phase 24 billing architecture? **Yes**, fully.
13. Can agency plan entitlements be evaluated? **Yes** — `getEntitlements`/`hasEntitlement` are
    ownerType-agnostic and work unchanged; `max_businesses` is real and enforced.
14. Can future usage limits be added without rewriting controllers? **Yes** —
    `agencyEntitlement.service.ts`'s `reserveBusinessSlot`/`getMaxBusinesses` pattern generalizes to
    any future numeric limit the same way.
15. Do existing single-business owners remain completely unaffected? **Yes** — confirmed by the full
    existing 753-test Jest suite and 35-spec pre-Phase-25 Playwright suite staying green unmodified.
16. Does custom-domain management continue working? **Yes**, untouched — `DomainMapping` still keys
    off `Restaurant`/location, unaffected by `Business.agencyId`.
17. Does shared-menu architecture remain intact? **Yes**, untouched — `Category`/`MenuItem`
    canonical/override architecture doesn't know or care whether its `Business` has an `agencyId`.
18. Do business analytics and promotions remain tenant-safe? **Yes** — an agency member reaching them
    goes through the same, now-extended `requireBusinessMatch`, which resolves to exactly one
    business per request, same isolation guarantee as before.
19. Are all important agency actions auditable? **Yes** — `AgencyAuditLog` for agency-scoped events,
    the existing `AuditLog` (fanned out per-restaurant) for business-scoped ones, mirroring the
    established dual-trail pattern from Phase 23's business promotions.
20. Is the architecture ready for a real billing provider later? **Yes** — no change needed; the
    provider abstraction is already ownerType-agnostic.
21. Is the architecture ready for delivery-provider integrations later? **No change either way** —
    this phase didn't touch delivery at all; that remains exactly as ready (or not) as before.
22. What is still genuinely missing before "commercially complete"? Real billing, real pricing, the
    UI wiring for #6/#7 above, agency-level analytics aggregation, and everything already listed as
    deferred in Phases 22-24 (public API, POS, AI, notifications). This phase is a real, tested
    foundation — not a launch-ready product, and this report makes no such claim.

## Phase 26 — Agency Business Operations, Unified Admin Navigation

### Context

Phase 25 deliberately stopped at "business-level access only" — Section 33 answer #6/#7 above says
so plainly: an agency member could see and manage a business's settings/analytics/promotions/billing,
but had **no path at all** into that business's actual day-to-day operations (Orders, Kitchen,
Tables, Staff, location Domains). Phase 26 closes that gap: an agency user can now genuinely operate
a managed business's locations through the *existing* admin UI — no impersonation, no duplicate
admin app, no weakening of tenant isolation.

### Reconnaissance findings

Three parallel Explore agents (admin frontend routing/context, backend authorization/sockets,
operational-page inventory) confirmed the real blocker was deeper than routing:

- Every location-operational route (`/restaurants/:restaurantId/...` — orders, kitchen, tables,
  staff, menu overrides, location domains) is guarded by `requireTenantMatch()` →
  `canAccessRestaurant()` (`middleware/tenant.ts`), which had **zero knowledge of
  `agencyMemberships`** — an agency member 403'd on all of it regardless of any frontend change.
- Every operational admin page already resolves its scope through exactly two idioms —
  `useActiveLocationId()` (`LocationContext`) or `user!.businessId!` (`AuthContext`) — never a URL
  param, and the API client injects nothing. This meant **no page itself needed to change** if the
  *context* supplying those ids could be made to work for an agency member too.
- `LocationContext` resolved its business scope strictly from `user.businessId`, which is always
  `undefined` for an `agency_member` account (they have no business of their own) — so an agency
  user got `locations: []` permanently, with no code path to ever populate it for a business they
  merely manage.
- Every route currently gated by a bare `roles: RESTAURANT_ROLES` array (Dashboard, Kitchen, Print)
  could never admit an `agency_member`, since that account's own site-wide `role` never becomes
  `"restaurant_owner"` etc. by entering a business.

### Core architectural decisions

**1. `canAccessRestaurant` gained an agency branch, reusing Phase 25's exact function one hop
deeper.** `businessLocation.ts`'s `agencyGrantsBusinessAccess` (previously module-private) is now
exported and reused verbatim from `tenant.ts`: after the existing owner/manager/staff/kitchen_staff
checks fail, if the user holds any agency membership, resolve the target restaurant's `businessId`
(the same read the owner/manager branch already does) and call `agencyGrantsBusinessAccess` — no
agency-access logic is duplicated. Because `canAccessRestaurant` is shared by both
`requireTenantMatch` (Express) and the Socket.IO handshake, this one change fixes **both** REST and
socket authorization. A new `resolveTenantAccess()` is the one real implementation (returns
`{allowed, agencyRole?}`); `canAccessRestaurant` is now a thin boolean wrapper around it so the
socket handshake's call site needed no change, while `requireTenantMatch` uses the richer result to
set `req.agencyRole` — mirroring `requireBusinessMatch`'s identical pattern exactly.

**Design decision**: `agency_staff`'s explicit `AgencyMembership.businessIds` assignment grants
access to *every* location under that business, not a further location-level list. Phase 25
established business as the unit of explicit assignment; a second, location-level assignment axis
wasn't asked for and would only add complexity with no proven need.

**2. One unified permission-grant map, not two.** `Permission` (`rbac.ts`) is a single flat
vocabulary already reused across business- and location-scoped routes (e.g.
`restaurant.settings.manage` gates both a business-level domain list *and* a location-level domain
write). `AGENCY_ROLE_BUSINESS_GRANTS` was renamed to `AGENCY_ROLE_GRANTS` (function
`agencyRoleGrantsBusinessPermission` → `agencyRoleGrantsPermission`) and now governs both
`requireBusinessPermission` (business-scoped routers) and the new `requireTenantPermission`
(location-scoped routers) — one map, no risk of drift between the two scopes. New grants added:

```
agency_owner  += restaurant.orders.read, restaurant.orders.manage, restaurant.tables.manage,
                 restaurant.staff.manage, restaurant.audit.read
agency_admin  += restaurant.orders.read, restaurant.orders.manage, restaurant.tables.manage,
                 restaurant.audit.read                    (no staff.manage — owner-only, HR-adjacent)
agency_staff  += restaurant.orders.read                    (read-only: Orders/Kitchen view, no
                                                             manage, no tables, no staff)
```

`restaurant.payments.manage` is **deliberately excluded from every agency role** — restaurant
payment-provider credentials stay owner-only, a conservative, documented product decision distinct
from SaaS billing (`billing.manage`, already granted to `agency_owner`).

**3. `requireTenantPermission(...permissions)`** — the location-scoped analog of
`requireBusinessPermission`, swapped in via the same import-alias trick Phase 25 used
(`import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/
tenant.js"`) on `restaurantOrder.routes.ts`, `table.routes.ts`, `staff.routes.ts`,
`restaurantDomain.routes.ts`. `menu.routes.ts`/`category.routes.ts`/`modifier.routes.ts` (location
overrides) only enforce `requireTenantMatch()` with no router-level permission gate, so they became
agency-aware automatically once `requireTenantMatch` itself admits agency users — no change needed.

**4. Socket.IO** — the handshake now copies `agencyMemberships` onto `socket.data` (previously
missing), and its existing `canAccessRestaurant(...)` call becomes agency-aware for free via #1. No
other socket change was needed: disconnect/reconnect-on-location-switch already worked
(`LocationContext.tsx`), it just needed correct inputs reaching it (see #5).

**5. Frontend — a new `BusinessContext`, not a page-by-page rewrite.** `BusinessContext.tsx`
computes `activeBusinessId` as `user.businessId` for real restaurant-role accounts (zero behavior
change) or as an agency member's explicitly-entered business (`enterBusiness()`, persisted to
`localStorage["enteredBusiness:{userId}"]` as `{businessId, businessName, agencyId, agencyName,
agencyRole}` — display names carried through from the caller so Layout's banner needs no extra
fetch). **The one load-bearing change**: `LocationContext.tsx` now reads `activeBusinessId` from
`useBusiness()` instead of `user.businessId` directly — every downstream resolution (`GET
/businesses/:businessId/locations`, the localStorage location preference, the socket `locationId`)
is otherwise unchanged. This is the single seam that makes every existing operational page
(Menu/Orders/Kitchen/Staff/Delivery/Domains/Settings/...) work for an acting-as-agency session with
**zero page-level changes** — exactly mirroring Phase 25's single-seam `requireBusinessMatch`
extension, just on the frontend.

**6. Route guards converted from `roles` to `permission`.** `App.tsx`'s own stated convention
already prefers `permission` (a documented reaction to a past Phase 11 nav/route-drift bug). The
three remaining `roles: RESTAURANT_ROLES`-gated routes — `/` (Dashboard), `/kitchen`, `/print/:mode/
:id` — were converted to `permission="restaurant.orders.read"` / `"restaurant.orders.manage"` /
`"restaurant.orders.read"` respectively (permissions every previously-guarded role already holds, so
zero behavior change for existing accounts), with `/print` gaining an explicit `allowPlatformAdmin`
bypass prop on `RequireAuth` for its one platform_admin carve-out. `RequireAuth`'s permission check
now also passes when `BusinessContext.agencyRoleForActiveBusiness` grants the permission, via the
SAME `agencyRoleGrantsPermission`/`AGENCY_ROLE_GRANTS` the server checks — client and server can
never drift apart on what an agency role can reach.

**7. Layout — a fourth nav state.** `isRestaurantScoped` now keys off `BusinessContext.
activeBusinessId` (true for a real restaurant-role account's own business, or an agency member's
entered one); `isAgencyScoped` (nav selection) is true only when agency-role AND no business
currently entered. Acting-as renders the same `RESTAURANT_GROUPS` nav, filtered by
`agencyRoleGrantsPermission` alongside the existing `roleHasPermission` check (so `agency_staff`
correctly doesn't see Staff/Tables), plus a persistent "Managing **{business}** via {agency} · ←
Back to Agency" banner. The Kitchen nav item, previously ungated (relying on every real restaurant
role happening to have `orders.manage`), is now explicitly `permission`-gated too — an
`agency_staff` acting inside a business does NOT have that grant, and an ungated nav item would
otherwise show a link that 403s on click, the exact Phase-11 drift class this convention exists to
prevent. `Outlet`'s remount key now includes `activeBusinessId` alongside `activeLocationId`, so
switching businesses always forces a fresh fetch even if the two businesses happen to resolve to the
same relative location position.

**8. New pages.** `AgencyBusinessDetailPage.tsx` (`/agency/businesses/:businessId` — one of the few
genuinely param-based routes, since this is a distinct resource view, not a context-driven
operational page): business overview, owner invite status with a **resend-invite** action (new
`resendAgencyBusinessOwnerInvite`, mirroring `platform.controller.ts`'s/`staff.controller.ts`'s
existing resend pattern exactly — fresh token invalidates the old one, refuses once already
accepted), full locations list, subscription snapshot (shown only if the caller's agency role grants
`billing.read`), and the **"Manage this business"** button that calls
`businessContext.enterBusiness(...)` and navigates to `/`. `AgencyBusinessesPage.tsx` gained a
"Manage" link per row into the new detail page.

**9. Audit trail — no new dual-write for routine operations.** Phase 25's `AgencyAuditLog` +
`AuditLog` dual-write was for discrete, significant agency-initiated events (business created).
Routine operational actions taken by an agency member while acting-as a business (marking an order
ready, editing a table) continue to write only the existing `AuditLog` — its actor is always the
real, non-impersonated agency user, already satisfying "who did what to which business/location."
Entering/managing a business (resend-invite) does get an `AgencyAuditLog` entry
(`agency.business_owner_invite_resent`, new action), consistent with Phase 25's granularity.

### Security & concurrency verification

Proven via real HTTP requests against the actual routers (not middleware-unit tests), extending
`agency.controller.test.ts`: `agency_owner`/`agency_admin` reach Orders/Tables/Staff/Domains for a
managed business's locations; `agency_admin` is denied Staff specifically (the one deliberately
owner-only grant); `agency_staff` without a `businessIds` assignment is denied outright (tenant match
itself fails, before any permission check); once assigned, `agency_staff` reaches Orders (read) but
not Tables (no grant); no agency member — any role — reaches a location under a business their
agency doesn't manage, or a business managed by a *different* agency. `GET .../businesses/
:businessId` 404s (not 403) for a business under a different agency, never leaking existence.
`resendAgencyBusinessOwnerInvite` is permission-gated (`agency.businesses.manage`) and refuses once
already accepted. The full pre-existing 764-test Jest suite (753 + this phase's 31 new tests) and all
34 Playwright specs (33 pre-existing + this phase's extended `agency-management.spec.ts`) pass
unmodified — zero regression to individual-owner businesses, location isolation, menu, orders,
kitchen, delivery, payments, analytics, promotions, domains, billing, or audit logging.

### Migration

None required — `Business.agencyId` remains optional and unset by default (Phase 25's precedent);
this phase added no new fields to any persisted document except the new `AgencyAuditLog` action enum
entry, which is purely additive to a string-enum field.

### What was deliberately deferred (matching the brief's own Section 38 non-goals list)

Real billing provider integration and platform payment receiving, final pricing, delivery-provider
integrations, public API, POS, AI features, WhatsApp integration, advanced agency BI beyond Phase
23's existing per-business summaries, full invoicing, a final branding/design pass — all unchanged
from Phase 25's own deferred list. New to this phase's own scope: agency-staff location-level (not
just business-level) explicit assignment — the business remains the unit of assignment by design
(see decision #1's reasoning).

### Section 40 — honest final assessment

- **Agency architecture**: solid and now load-bearing end to end — an agency member can create a
  business, invite its owner, and actually operate its locations, all server-verified.
- **Agency UX**: functional, not yet polished — the enter/exit flow works and is discoverable (one
  button, one banner, one "Back to Agency" link), but has had no dedicated visual design pass.
- **Business switching**: works (exit one, enter another) but is a two-click round-trip through the
  Businesses list, not a single in-place switcher like the location `<select>` — a reasonable next
  UX improvement, not attempted this phase to keep scope bounded.
- **Location switching**: fully reused, unchanged — Phase 19's `LocationContext` now transparently
  serves agency-entered businesses too.
- **Operational access**: real for Orders/Kitchen/Tables/Staff/Domains, scoped correctly per agency
  role.
- **RBAC**: one unified permission map now governs business- and location-scoped agency grants;
  proven not to leak platform_admin or cross-agency/cross-business access.
- **Tenant isolation**: unchanged and re-verified — `requireTenantMatch`'s real restaurant-role fast
  paths are untouched; the entire existing isolation test suite passes unmodified.
- **Menu**: canonical writes (business-level, Phase 21) and location overrides both correctly
  reachable per the same grant map; `resolveMenuForLocation` untouched.
- **Orders / Kitchen**: real, tested, permission-scoped (owner/admin manage, staff read-only).
- **Delivery**: untouched this phase; delivery *settings* are reachable via `restaurant.settings.
  manage` (already granted to owner/admin) exactly like before.
- **Payments**: deliberately NOT granted to any agency role — restaurant payment-provider
  credentials remain owner-only, distinct from agency subscription billing.
- **Analytics / Promotions**: unchanged from Phase 25 (business-level, already agency-aware);
  location-level analytics/promotions now also reachable through the new tenant-match branch.
- **Domains**: location-level domain writes now correctly reachable for owner/admin via the same
  `restaurant.settings.manage` grant already used at business level.
- **Billing**: agency subscription and business subscription remain completely separate systems, as
  before — this phase touched neither.
- **Audit logging**: business/location actions still attribute to the real agency user via the
  existing `AuditLog`; agency-level actions (business creation, invite resends) via `AgencyAuditLog`.
- **Testing**: full regression standard met — real HTTP authorization tests, a real browser-driven
  Playwright journey (register → create agency → create business → enter → Menu/Orders → exit →
  isolation), zero regressions across 764 Jest tests and 34 Playwright specs.
- **Global readiness**: still a foundation, not a launch-ready product — no real billing provider, no
  final pricing, no delivery-provider integrations, no polish pass.
- **Remaining commercial blockers**: real billing/payment-receiving, final pricing, a dedicated
  agency UX/design pass (in-place business switcher, richer dashboard), agency-staff location-level
  assignment if ever needed, and everything already listed as deferred in Phases 22-25.

**Next highest-value work**: a real billing provider integration (the single largest remaining gap
before any commercial launch), followed by an agency UX polish pass (in-place business switcher) once
the underlying mechanism proven this phase has had time to be used in practice.
