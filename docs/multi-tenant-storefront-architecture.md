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
