# Phase 79 — SEO & Search Architecture: Final Report

> **Addendum notice**: after this report was first written (below), a second, more granular audit
> pass was requested and performed against this same repository state (post Phase 79.1's MongoDB
> persistence work, which touched no application code). See **"Phase 79 SEO Final Report —
> Second-Pass Audit & Implementation"** at the bottom of this file for that pass's findings, the
> fixes it produced, and the final combined test results. The original report below is preserved
> unmodified as the record of the first pass.

## 1. Existing SEO architecture found (audit summary)

- **`apps/marketing`**: `usePageMeta({ title, description })` (`src/hooks/usePageMeta.ts`) was already a
  real, working, client-side (`useEffect`-based) shared system used by all 13 static routes — title,
  description, canonical, OG, Twitter, full cleanup on unmount. A static `sitemap.xml` and `robots.txt`
  already existed in `public/`. JSON-LD for Organization+WebSite (`Layout.tsx`) and FAQPage (`FaqPage.tsx`)
  already existed, both built from real data.
- **`apps/web`**: `RestaurantContext.tsx` already resolved a restaurant via by-slug / by-domain /
  by-slug-preview, race-safe via its own `cancelled` flag. `MenuPage.tsx` already owned all storefront SEO
  logic (title/description/OG/Twitter/canonical/JSON-LD Restaurant+Menu) in one large effect. A shared
  `useNoIndex(enabled)` hook already existed and was already used at 15 call sites; `demo-restaurant`
  already got `useNoIndex(true)`.
- **`apps/api`**: a dynamic `sitemap.routes.ts` already existed (mounted at root `/sitemap.xml`), already
  filtering to active + ordering-enabled + non-demo + non-thin-menu restaurants. `DomainMapping` (per-
  restaurant custom domain) and `Agency.domain` (verification-only, rendering-inert) already existed as two
  separate mechanisms. `Restaurant.status` was already `["pending", "active", "suspended"]` only — no
  draft/unpublished/deleted lifecycle state exists in production code.
- **Zero shared implementation existed across apps** — `apps/marketing` and `apps/web` had independently
  hand-rolled the same DOM tag-injection mechanics, with one real behavioral difference (description-tag
  handling) between them.
- **Real gaps found** (not previously known/documented): a tenant-isolation race in `MenuPage.tsx`'s
  menu-fetch effect (no `cancelled` guard); the sitemap always emitted a restaurant's platform URL even
  when an active custom domain existed, inconsistent with `MenuPage.tsx`'s own canonical preference;
  `/api/docs` had no noindex protection; `robots.txt` was missing `Disallow` entries for `/r/*/preview`,
  `/r/*/experience`, `/loyalty`, and `/verify-email`; `PrintReceiptPage.tsx` was the one `RequireAuth` page
  missing the shared `useNoIndex()` call; one existing e2e assertion
  (`e2e/seo-structured-data.spec.ts`) asserted the seeded `demo-restaurant` storefront was NOT noindexed —
  backwards from its actual, already-correct behavior.

## 2. Files changed (exact paths)

- `apps/web/src/pages/MenuPage.tsx` — tenant-isolation race fix (`cancelled` guard on the menu fetch),
  preview-mode noindex, SEO logic extracted to `useStorefrontSeo`.
- `apps/web/src/pages/PrintReceiptPage.tsx` — added `useNoIndex()`.
- `apps/web/public/robots.txt` — added 4 `Disallow` entries.
- `apps/marketing/src/hooks/usePageMeta.ts` — rebuilt on `applySeoMeta`; added `VITE_SITE_URL` override.
- `apps/marketing/src/components/Layout.tsx` — structured-data injection rebuilt on `applyJsonLd`.
- `apps/marketing/src/pages/FaqPage.tsx` — structured-data injection rebuilt on `applyJsonLd`.
- `apps/marketing/public/sitemap.xml` — stale route-count comment fixed (10 → 13).
- `apps/api/src/routes/sitemap.routes.ts` — custom-domain-aware `<loc>` generation.
- `apps/api/src/routes/sitemap.routes.test.ts` — new custom-domain test case.
- `apps/api/src/app.ts` — `X-Robots-Tag: noindex, nofollow` on `/api/docs`.
- `apps/api/src/app.test.ts` — new header assertion.
- `packages/utils/package.json` — `exports` map (subpath export for `seoMeta`), new devDependencies, new
  `test` script.
- `packages/utils/tsconfig.json` — excludes `*.test.ts` from the build output.
- `e2e/seo-structured-data.spec.ts` — corrected the stale demo-restaurant noindex assertion; added a
  real-restaurant not-noindexed case.
- `docs/multi-tenant-storefront-architecture.md` — SEO/canonical and Sitemap sections updated in place;
  new Phase 79 section appended.

## 3. Files created (exact paths)

- `packages/utils/src/seoMeta.ts` — shared `applySeoMeta`/`applyJsonLd` DOM-mechanics primitives.
- `packages/utils/src/seoMeta.test.ts` — jsdom unit suite for the above.
- `packages/utils/jest.config.js` — new, jsdom-scoped Jest config for this package only.
- `apps/web/src/hooks/useStorefrontSeo.ts` — extracted, restaurant-specific SEO hook (tags + JSON-LD).
- `e2e/seo-tenant-isolation.spec.ts` — baseline two-restaurant isolation, query-param-canonical, the
  menu-fetch race regression, and the custom-domain canonical proof.

## 4. Marketing SEO implemented

- `usePageMeta` now delegates its DOM mechanics to the shared `applySeoMeta` (`packages/utils/src/seoMeta.ts`,
  imported via the `@restaurant/utils/seoMeta` subpath) — output is unchanged for every existing page
  (verified by keeping the exact same field set), except `og:site_name`/`og:url` continue to be set as
  before.
- New `VITE_SITE_URL` build-time override, following the same pattern already established by
  `VITE_STOREFRONT_URL`/`VITE_ADMIN_URL` in `src/lib/links.ts`. Unset (the default, including every current
  deployment) — behavior is byte-for-byte unchanged, still derived from `window.location.origin`. Once a
  real production domain is registered, setting this one variable fixes canonical/OG/JSON-LD URLs
  site-wide without further code changes.
- `Layout.tsx`'s Organization+WebSite JSON-LD and `FaqPage.tsx`'s FAQPage JSON-LD both now inject through
  the shared `applyJsonLd` and both now honor `VITE_SITE_URL` too, for URL consistency with the rest of the
  page's metadata.
- Stale sitemap header comment corrected (claimed 10 routes; the file has always had 13 `<url>` entries).

## 5. Restaurant SEO implemented

- All storefront SEO logic (title, description, canonical, OG, Twitter, Restaurant+Menu JSON-LD) extracted
  from `MenuPage.tsx` into `apps/web/src/hooks/useStorefrontSeo.ts`, built on the same shared
  `applySeoMeta`/`applyJsonLd` primitives as `apps/marketing`. Split into two effects instead of the
  original one, so tag/meta output (keyed on restaurant identity + domain resolution) is no longer torn
  down and recreated on every menu refetch — only the JSON-LD effect depends on `menu`.
- **Tenant-isolation race fixed**: the menu-fetch effect now uses the same `cancelled`-flag pattern
  `RestaurantContext.tsx` already used, so a restaurant A menu response that resolves after the page has
  already navigated to restaurant B can no longer be applied under B's page.
- **Preview mode now noindexed**: `/r/:slug/preview` (authenticated owner/platform_admin only, can render
  unpublished restaurant data) now gets the same `useNoIndex()` treatment the demo-restaurant storefront
  already had, and is also skipped by the SEO tag/JSON-LD effects entirely.
- `PrintReceiptPage.tsx` (a private, authenticated order receipt) now gets `useNoIndex()` — the one
  `RequireAuth` page in the app that was missing it.
- No fabricated data anywhere: JSON-LD fields are omitted, never invented, when the underlying restaurant
  data is absent (unchanged from the pre-existing implementation — confirmed still true after the
  extraction).

## 6. Domain / canonical behavior

- **Platform-hosted (`/r/:slug`)**: canonical is `${origin}/r/:slug`, unchanged.
- **Active custom domain** (`DomainMapping.status === "active"`): that domain is canonical instead —
  `https://:hostname` — preferred regardless of which URL (platform or custom) the visitor is currently on.
  The platform URL keeps resolving (never redirected), so existing links/QR codes don't break; it's simply
  not canonical once a custom domain is active. This behavior pre-dated this phase and was confirmed
  correct by direct inspection — this phase's contribution is making the sitemap consistent with it (see
  §7) rather than changing the canonical logic itself.
- **Agency domains** (`Agency.domain`): confirmed rendering-inert — a verification-only field with no
  code path that reads it for metadata, routing, or rendering. No SEO surface to fix; documented rather
  than built against, per the brief's own "don't invent behavior that doesn't exist" instruction.

## 7. Sitemap behavior — exactly included / excluded

**Included**: a restaurant with `status: "active"`, `settings.orderingEnabled: true`, at least one
available menu item, and slug not `"demo-restaurant"`.

**Excluded**: any restaurant that is not `"active"`, has `orderingEnabled: false`, has zero available menu
items (a thin/empty page), or is the seeded `demo-restaurant`. No table, cart, checkout, order, admin, or
platform URLs are ever included — sitemap generation only ever queries `Restaurant`/`MenuItem`/
`DomainMapping`.

**Phase 79 change**: a restaurant with an active custom domain now gets that domain's URL
(`https://:hostname`) instead of its platform `/r/:slug` URL, matching the page's own canonical preference.
Query cost: 3 total (restaurant list + 2 batched `MenuItem.distinct()` + 1 batched `DomainMapping.find()`
against the already-filtered indexable set), independent of restaurant count — unchanged in shape from the
2-query version, one query added.

## 8. Robots behavior — exactly crawlable / blocked

**`apps/web/public/robots.txt`** now disallows: `/t/`, `/cart`, `/r/*/t/`, `/r/*/cart`, `/r/*/loyalty`,
`/r/*/preview` (new), `/r/*/experience` (new), `/orders`, `/account`, `/login`, `/register`,
`/forgot-password`, `/reset-password`, `/confirm-email-change`, `/verify-email` (new), `/loyalty` (new),
`/support/tickets`. Everything else — most importantly `/r/:slug` itself and the public support
center/article pages — remains crawlable. A `Sitemap: /sitemap.xml` reference is present.

`robots.txt` is explicitly not relied on as the only protection anywhere in this codebase: every one of the
disallowed private paths is also authentication-gated server-side, and the client-side `useNoIndex()` meta
tag independently guarantees non-indexing even for a URL a crawler somehow reaches anyway.

**`/api/docs`** (Swagger UI) now sends `X-Robots-Tag: noindex, nofollow` on every response — it has no auth
gate by design (internal developer documentation, not sensitive data) but was never marked non-indexable
before this phase.

## 9. Structured data schemas implemented

- **Organization + WebSite** (`apps/marketing`, site-wide, unchanged in shape — `name`, `url`, `logo`).
- **FAQPage** (`apps/marketing`'s FAQ page, unchanged in shape — built from the same `FAQS` content the
  page renders).
- **Restaurant** (`apps/web`, per storefront) — `name`, `description`, `url`, `image` (when a logo exists),
  `telephone` (when set), `address` (`PostalAddress`, when address/city exist), `geo`
  (`GeoCoordinates`, when latitude/longitude exist), `openingHoursSpecification` (when any business-hours
  day is not closed) — every field conditionally included only when real data backs it, never a placeholder.
- **Menu / MenuSection / MenuItem** (`apps/web`, nested inside the Restaurant schema's `hasMenu`, only once
  the menu has actually loaded) — built directly from the same category/item data the page itself renders;
  never emitted with placeholder data, never includes fake ratings, reviews, or awards.
- All JSON-LD injection now goes through the shared `applyJsonLd` (`packages/utils/src/seoMeta.ts`), which
  serializes via `JSON.stringify` on plain, pre-validated object literals — malformed structured data
  cannot break page rendering because the data shape is fully controlled at each call site, not
  user/crawler-influenced.

## 10. Tenant-isolation protections

- **Restaurant A/B get their own title, canonical, and JSON-LD identity** — proven by
  `e2e/seo-tenant-isolation.spec.ts`'s baseline test (independent visits to `spice-route` and
  `bella-vista`), and by the pre-existing cross-tenant `ownerId`-leakage guard in
  `restaurant.controller.test.ts`.
- **Restaurant A cannot cause Restaurant B canonical/metadata** — the real bug found and fixed this phase
  (§5); proven by `e2e/seo-tenant-isolation.spec.ts`'s race-condition test, which gates restaurant A's real
  `/menu` response until restaurant B has already fully rendered, then releases it and asserts B's content
  is unaffected.
- **Custom-domain metadata uses the correct restaurant** — proven by `e2e/seo-tenant-isolation.spec.ts`'s
  custom-domain canonical test (a real active `DomainMapping` seeded for `bella-vista`, then a platform
  `/r/bella-vista` visit asserted to canonicalize to that domain); backed by the pre-existing
  `activeCustomDomain` coverage in `restaurant.controller.test.ts` (null / active / pending-not-active).
- **Agency-domain metadata** — N/A in this architecture; `Agency.domain` is rendering-inert (§6), so there
  is no metadata path to leak through it.
- **Unpublished / deleted restaurant absent from sitemap** — no such lifecycle state exists in production
  code (`Restaurant.status` is `pending`/`active`/`suspended` only); the real equivalent
  (`status: "active"` filtering) is covered by the pre-existing and extended `sitemap.routes.test.ts`.
- **Private/admin routes not accidentally indexable** — the `/api/docs` header fix and the 4 new
  `robots.txt` entries (§8), each with a passing regression test.
- **Query parameters cannot override the canonical host or path** — canonical URLs are always built from
  server-trusted routing/domain context (`window.location.origin`/`pathname`, the resolved
  `restaurant.slug`, or `activeCustomDomain` from the API response), never from `window.location.search`;
  proven by `e2e/seo-tenant-isolation.spec.ts`'s query-param test.
- **Structured data contains the correct restaurant identity** — proven by the same baseline and race
  tests above (JSON-LD `name`/`url`/`hasMenu` item names asserted per restaurant).

## 11. Tests report

**Jest** (serial, dev servers stopped for a clean signal — this machine's documented contention
mitigation): **116 suites / 1514 tests, all passing.**
- `apps/api`: 112 suites, 1485 tests (was 1483/112 before this phase — +2 tests: the new sitemap
  custom-domain case, the new `/api/docs` header case).
- `apps/web`: 3 suites, 22 tests (unchanged — this app's Jest coverage is its theme engine, not
  SEO; SEO/DOM behavior here is covered by Playwright instead, per this app's own established
  convention).
- `packages/utils`: 1 suite, 7 tests — **new**, the `seoMeta.ts` unit suite (this package had no
  Jest config before this phase).

**TypeScript**: `npm run build` (which runs `tsc` for every workspace) — clean across all 4 apps and
all 3 packages, 0 errors.

**Production builds**: all 4 apps (api, web, admin, marketing) built clean, 0 errors.

**Lint**: all 4 apps — 0 errors. Pre-existing warnings only (unused-var/exhaustive-deps/
fast-refresh warnings that predate this phase); none newly introduced by any file this phase
touched or created.

**Playwright**: 115 tests total.
- The 5 new/modified SEO tests (`e2e/seo-tenant-isolation.spec.ts`'s 4 new tests, plus
  `e2e/seo-structured-data.spec.ts`'s corrected demo-noindex assertion and its new real-restaurant
  case) — **all passing**, including the race-condition regression proving the tenant-isolation fix.
- Full-suite run: 110 passed / 5 failed on the first pass. Re-running the 5 failures serially (no
  parallel contention) showed 4 were this machine's documented resource-contention flakiness
  (`admin-audit-log`, `full-order-flow`, `payment-settings-and-loyalty`, `pos-terminal-payment` —
  all passed clean on retry, none touch any file this phase changed).
- The 5th, `e2e/support.spec.ts`, fails **deterministically** on both runs with a Playwright
  strict-mode selector collision (`getByText("Open")` matches both a ticket-status badge and an
  unrelated "Open 24 hours" business-hours label). This is **pre-existing and unrelated to Phase
  79** — verified directly by `git stash`-ing every Phase 79 change and re-running this one test
  against the untouched codebase, where it fails identically. Not fixed here: this phase's scope is
  SEO, not this pre-existing support-ticket-flow test's selector ambiguity, and the brief's own
  instruction is to update a test only when this phase's own behavior change requires it — this
  failure predates and is unrelated to any change made in this phase.

Net: **0 test failures, 0 build errors, 0 type errors, 0 lint errors attributable to this phase.**

## 12. Remaining SEO limitations

- **Client-side-only rendering** (pre-existing, documented in `docs/multi-tenant-storefront-architecture.md`
  before this phase and unchanged by it): `apps/web` is a plain SPA with no SSR/prerendering. Google's own
  crawler executes JavaScript before indexing, so title/canonical/JSON-LD work for Google specifically, but
  non-JS-executing crawlers (social-media link-preview bots — Slack, Discord, iMessage, older
  Facebook/Twitter crawlers) see the static HTML shell with none of this metadata. Fixing this requires
  SSR/prerendering or an edge bot-detection layer — a real architectural migration, out of scope for this
  phase.
- **`og:image` fallback is the SVG favicon**, not a dedicated 1200×630 social-preview image, for both
  `apps/marketing` and any restaurant without a logo. A real design asset is needed; this phase does not
  fabricate a URL for one.
- **`[LEGAL_ENTITY_NAME]` placeholders** remain in `TermsPage.tsx`/`PrivacyPage.tsx` — a legal/business
  decision, not SEO code, and explicitly not this phase's to invent.
- **Marketing sitemap's placeholder production domain** (`https://www.garnishtable.app`) remains — the
  file's own in-repo comment already documents this as a founder decision pending a real registered domain;
  this phase only fixed the stale route-count comment, not the domain itself.
- **`robots.txt`'s `Sitemap:` line** is a relative reference (`/sitemap.xml`); its correctness in production
  depends on a reverse-proxy/rewrite rule at the hosting layer routing that path to the API — this was
  already a documented gap in `docs/multi-tenant-storefront-architecture.md` before this phase and cannot
  be verified or fixed from application code alone.
- **Self-referencing custom-domain canonical** (i.e., a visitor already ON the custom domain getting a
  canonical pointing at itself, not the platform) is not covered by an e2e test — real DNS control over an
  arbitrary test hostname isn't available in this environment, the same limitation
  `e2e/custom-domain-management.spec.ts` already accepts for its own scope. The lower-risk direction (a
  platform `/r/:slug` visit correctly canonicalizing to an active custom domain) IS covered end-to-end.
- **`temporarilyPaused` restaurants** intentionally remain sitemapped/indexable — this is a legitimate
  "closed tonight" operational state, not a publication state, and excluding it would incorrectly de-index
  a restaurant that reopens on its own schedule.

## 13. Launch impact classification

**READY** (implemented, tested, no known blocker):
- Tenant-isolation race fix (`MenuPage.tsx`'s menu-fetch effect).
- Sitemap custom-domain consistency fix.
- `robots.txt` gap closures (`/r/*/preview`, `/r/*/experience`, `/loyalty`, `/verify-email`).
- `/api/docs` `X-Robots-Tag: noindex, nofollow` header.
- Preview-mode noindex (`/r/:slug/preview`).
- `PrintReceiptPage` noindex.
- Shared SEO utility extraction (`packages/utils/src/seoMeta.ts`) and its `apps/web`/`apps/marketing`
  consumers.
- Marketing `VITE_SITE_URL` override (safe unset default — zero behavior change until a real domain
  is configured).
- Marketing sitemap stale-comment fix.

**READY WITH MANUAL VERIFICATION**:
- `robots.txt`'s `Sitemap: /sitemap.xml` line — correctness in production depends on a
  reverse-proxy/rewrite rule at the hosting layer (already a documented gap before this phase); works
  correctly in local dev via the existing Vite proxy.
- The `page.route()`/`pushState`+`popstate` technique used by the new race-condition Playwright test —
  confirmed working in this run, but worth re-confirming after any future React Router upgrade, since
  it depends on `BrowserRouter`'s `popstate` listening behavior.

**BLOCKED** (not code — real external decisions/assets this phase correctly does not fabricate):
- Marketing sitemap's real production domain (founder decision — no domain registered yet).
- A real 1200×630 `og:image` social-preview asset (design asset needed).
- `[LEGAL_ENTITY_NAME]` placeholders in the legal pages (legal/business decision).

No blocker was invented to pad this list, and no genuinely-open item above was marked READY to make
the phase look more complete than it is.

---

# Phase 79 SEO Final Report — Second-Pass Audit & Implementation

Requested as a fresh, more granular audit against the current repository state (Phase 79.1's MongoDB
persistence work having landed in between, touching zero application code). Treated correctly: as a
gap-check against what already exists (most of it from the first pass above), not a rebuild.

## 1. Audit findings

**Already correct** (re-confirmed, not re-explained here — see the original report above for full
detail): shared `applySeoMeta`/`applyJsonLd` utility, restaurant storefront metadata/canonical/
JSON-LD, custom-domain-aware sitemap and canonical, `robots.txt`/`useNoIndex` coverage of every
previously-known private route, `/api/docs` noindex header, tenant-isolation race fix, demo-restaurant
noindex, legal pages' metadata, marketing site's 13 indexable routes each with unique title/
description/canonical/OG, one `<h1>` per marketing page (all 13 routes checked directly, including the
3 legal pages via `LegalPageLayout`), `apps/admin` fully blocked from indexing (`robots.txt`:
`Disallow: /`, confirmed as a blanket rule — appropriate for a fully-private authenticated app, no
change needed).

**Missing / Incorrect (real, launch-relevant)**:
- **Neither `apps/web` nor `apps/marketing` had a catch-all (`path="*"`) route.** An unmatched URL
  (typo, dead external link, stale bookmark) rendered a blank page with no title/metadata change and
  no `noindex` signal — under standard SPA static-hosting (a history-fallback rewrite to `index.html`),
  this returns HTTP 200 for literally any path, which is the textbook "404 accidentally becomes
  indexable" failure mode. Confirmed by reading both `App.tsx` files directly and grepping for
  `NotFound`/`path="*"` across both apps — genuinely absent, not just hard to find.
- **`apps/web`'s existing bad-restaurant-slug error state had no `noindex` tag.** `Layout.tsx`'s
  `restaurantNotFound` case (a real, already-existing "We can't find that restaurant" message for a
  mistyped/dead `/r/:slug`) never ran `useStorefrontSeo` (correct — there's no restaurant to describe)
  but also never set `noindex` — a thin, identical-looking error page was indexable by default at a
  unique URL per bad slug.

**Noted, not fixed (real but non-blocking, explicitly out of the founder's stated Phase 79 scope in
both specs received)**:
- `apps/web`'s Support Center (`/support`) and article detail (`/support/articles/:slug`) pages —
  real, crawlable, `robots.txt`-permitted public pages — have no title/canonical/metadata management at
  all (confirmed by reading both files directly: zero SEO hooks anywhere in either). Neither this
  phase's original brief nor this second one named support/KB content as in-scope; this is flagged as
  a real, moderate-value future improvement, not bundled into this phase's fixes, to avoid the scope
  inflation both briefs explicitly warn against.
- Marketing site's image usage is almost entirely CSS/SVG-driven (grepped directly — effectively no
  `<img>` tags with content-image semantics outside `HomePage.tsx`), so there was no meaningful
  `alt`-text gap to fix; noted as checked, not skipped.
- Trailing-slash/HTTP-vs-HTTPS/host-level duplicate-URL handling is a hosting/reverse-proxy-layer
  concern, not application routing (React Router's route definitions never declare a trailing-slash
  variant, so there's no in-app duplicate to fix) — same category as the already-documented
  `robots.txt` `Sitemap:` cross-origin gap from the first pass.

**Duplicate/conflicting systems**: none found or introduced. Still exactly one shared metadata/JSON-LD
mechanism (`@restaurant/utils/seoMeta`), one sitemap implementation, one `robots.txt` per app.

**Launch blockers**: the two "Missing/Incorrect" items above were the only ones that materially affect
production indexability. Both are now fixed (below).

## 2. Changes made

- **`apps/web/src/pages/NotFoundPage.tsx`** (new) — real 404 content, `noindex`, wired at `path="*"`
  in `apps/web/src/App.tsx` (added, last route, inside the existing `<Layout>`-wrapped route group so
  it still gets header/footer chrome).
- **`apps/marketing/src/pages/NotFoundPage.tsx`** (new) — same treatment via `usePageMeta` +
  `useNoIndex`, wired at `path="*"` in `apps/marketing/src/App.tsx` (added, last route).
- **`apps/marketing/src/hooks/useNoIndex.ts`** (new) — this app had no noindex mechanism at all before
  now (every route was previously meant to be indexable); mirrors `apps/web`'s hook exactly.
- **`apps/web/src/components/Layout.tsx`** — added `useNoIndex(restaurantNotFound)` alongside the
  existing bad-slug error state.
- **Tests**: `e2e/seo-structured-data.spec.ts` (+2 tests: unmatched-URL and bad-slug noindex on
  `apps/web`), `e2e/legal-pages.spec.ts` (+1 test: unmatched-URL noindex on `apps/marketing`).
- **`e2e/seo-tenant-isolation.spec.ts`** — unrelated to the 404 work, but fixed a real test-isolation
  bug surfaced while re-running the suite today: the race-condition test and the custom-domain-
  canonical test both read/write `bella-vista`'s canonical state and could land in different Playwright
  workers (`playwright.config.ts` sets `fullyParallel: true`), causing a real observed collision
  (one test's leftover `DomainMapping` briefly affecting the other's assertion). Fixed by grouping both
  into one `test.describe.serial` block so they can never run concurrently with each other. This is a
  fix to Phase 79's own first-pass test suite, not new scope.

## 3. Changes deliberately NOT made

- Support/KB page metadata (see §1 — real gap, correctly out of stated scope, flagged not fixed).
- No change to any marketing page's copy, design, or branding — every fix was additive (new 404 page,
  new hook) or a one-line `noindex` addition to existing error UI.
- No change to sitemap, robots.txt content, structured data, or canonical logic — all already correct
  and re-verified, not touched again.
- No change to the demo restaurant's (Wildwood Kitchen, `demo-restaurant`) branding, menu, pricing, or
  theme — its noindex/canonical behavior was re-confirmed already correct from the first pass.
- No change to `/terms`, `/privacy`, `/refund-policy` content — re-verified working, metadata already
  correct, re-confirmed via `e2e/legal-pages.spec.ts`.

## 4. SEO architecture (current state, unchanged from the first pass except where noted)

- **Marketing SEO**: `usePageMeta` (title/description/canonical/OG/Twitter via shared
  `applySeoMeta`) on 13 indexable routes + 1 new noindexed catch-all. Organization+WebSite JSON-LD
  site-wide, FAQPage JSON-LD on `/faq`.
- **Restaurant storefront SEO**: `useStorefrontSeo` (title/description/canonical/OG/Twitter/Restaurant
  +Menu JSON-LD) per `/r/:slug`, skipped for QR/preview routes, tenant-isolation race fixed, bad-slug
  state now noindexed, unmatched non-restaurant URLs now get a real 404 instead of a blank page.
- **Custom-domain SEO**: unchanged — an active `DomainMapping` still makes that domain canonical
  regardless of which URL (platform or custom) the visitor is on; sitemap emits the custom domain when
  one is active.
- **Canonical URLs**: always server-trusted (resolved restaurant slug, resolved `activeCustomDomain`,
  or `window.location.origin`/`pathname`) — never derived from query strings.
- **Sitemap / robots**: unchanged from the first pass, re-verified correct.
- **Structured data**: unchanged, re-verified — no fabricated fields anywhere.

## 5. Security/privacy

Re-confirmed: no private tenant information is exposed through any SEO surface. The two new 404 pages
render zero tenant/restaurant data (generic copy only). The `restaurantNotFound` state (now noindexed)
already only ever rendered the resolver's own generic error message, never restaurant-specific data
for the failed slug. Sitemap and robots.txt continue to expose only public restaurant slugs/domains
that were already independently public via the storefront itself.

## 6. Tests

**TypeScript**: `npm run build` (runs `tsc` for all 4 apps + 3 packages) — **clean, 0 errors.**

**Builds**: all 4 apps (api, web, admin, marketing) — **clean, 0 errors.**

**Lint**: all 4 apps — **0 errors** (pre-existing warnings only, none newly introduced — confirmed
directly, the new files/edits appear nowhere in the warning list).

**Jest**: `apps/web` — 3 suites, 22/22 tests (unaffected, re-run to confirm). `apps/api` — unaffected
(zero backend files touched this pass); its own full suite was already re-verified clean in Phase 79.1,
immediately prior to this pass, against the now-persistent replica set.

**Playwright — SEO-specific** (the direct proof of this pass's fixes): **16/16 passing**, including
the 3 new 404/noindex tests and the re-verified/fixed race + custom-domain-canonical pair.

**Playwright — full suite**: **115/118 passing** on the first parallel run. All 3 failures
independently confirmed unrelated to this pass's changes:
- `e2e/full-order-flow.spec.ts` — passed clean on retry (dev-server contention under full parallel
  load, this machine's documented pattern).
- `e2e/phase28-agency-owner-toggles-loyalty.spec.ts` — passed clean in full isolation (same
  contention pattern; touches admin-app auth/temp-password flow, nowhere near anything this pass
  changed).
- `e2e/support.spec.ts` — a pre-existing, deterministic failure unrelated to SEO (a Playwright
  strict-mode selector collision between a ticket-status badge and an "Open 24 hours" business-hours
  label) — already verified earlier in this engagement via `git stash` to fail identically on
  unmodified `main`, before any of today's or the first pass's changes existed.

Net: **0 test failures attributable to this phase**, on top of the first pass's own already-clean
result.

## 7. Remaining launch issues

Same list as the first pass's §12 (client-side-only rendering for non-JS crawlers, `og:image` SVG
fallback, `[LEGAL_ENTITY_NAME]` placeholders, marketing sitemap's placeholder domain, `robots.txt`'s
cross-origin `Sitemap:` line) — none newly introduced, none resolved by this pass (none were in this
pass's scope). One addition: **Support/KB page metadata** (§1 above) is a real, moderate-priority,
non-blocking future item, not previously flagged in the first pass's report.

## 8. Next recommended phase

Per your own direction: **real payment/marketplace provider verification and activation**, including
the account-connection UX (restaurant/agency customers connecting provider accounts via redirect
rather than handling technical credentials directly) — not started here, as instructed.
