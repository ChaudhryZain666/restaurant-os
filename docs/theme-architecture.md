# Storefront Theme Architecture (Phase 31, extended Phase 33)

A restaurant's storefront needed to look like more than one restaurant. Before this phase, every
restaurant got the exact same layout, differing only in a single `brandColor` swap. This phase adds
a real theme engine: three structurally different storefront designs (not color variants of one
template), a small set of restaurant-controlled overrides on top of each, and an admin Theme Studio
to manage them — while keeping ordering, cart, checkout, payments, delivery, loyalty, auth, SEO, and
tenant isolation completely untouched by any of it.

## Three layers, never collapsed into one

1. **Theme Definition** — code, `apps/web/src/theme/registry.tsx`. Which themes exist, their
   default design tokens, their font stacks, and which React components render each part of the
   page. Developer-controlled, never persisted to the database, never restaurant-editable.
2. **Restaurant Theme Config** — database, `Restaurant.settings.theme` (published) and
   `Restaurant.themeDraft` (unpublished edits). Small and structured:
   `{ themeKey, themeVersion, colors, radius?, density?, sections }`. Defined in
   `packages/types/src/types/theme.ts`. Never a free-form style blob — every field is a closed
   enum or a hex color, validated by `packages/validation/src/theme.ts`'s `.strict()` Zod schema.
3. **Storefront Runtime** — `apps/web`. Merges layers 1 and 2 (`ThemeProvider` +
   `resolveThemeTokens`) and renders. Never touches ordering/cart/checkout logic — see "Component
   contract" below for how that separation is enforced structurally, not just by convention.

## Ownership: restaurant-level, not business-level

Theme selection lives on the `Restaurant` (location) document, matching the existing
`brandColor`/`logo`/`coverImage` precedent from before this phase. A `Business` with several
locations does **not** get a business-wide theme that its locations inherit — each location picks
its own theme independently, same as it already picks its own logo. Business-level theme
inheritance (a default theme new locations start from) is a reasonable future addition but was not
built here — it would need a real product decision about whether a location can still deviate from
it, which didn't have a clear answer yet.

## The three original themes (Phase 31)

> Superseded as the *promoted* collection by Phase 33's five new directions below, but still fully
> present in `THEME_REGISTRY` and still exactly what they always were — see "Phase 33" for why they
> were deliberately kept rather than replaced.

Defined in `apps/web/src/theme/registry.tsx`, one directory each under `apps/web/src/theme/`
(`classic/`, `modern/`, `editorial/`), each with its own `Header`, `Footer`, `Hero`, `CategoryNav`,
`MenuSection`, and section components (`Featured`, `About`, `Gallery`, `Cta`). These are not three
skins over one layout — they differ in DOM structure, not just CSS:

| | **Classic** | **Modern** | **Editorial** |
|---|---|---|---|
| Register | Warm, familiar restaurant site | Bold, high-contrast, confident brand | Quiet, refined magazine |
| Header | Sticky blurred bar, circular logo badge, pill nav links | Slim bar, uppercase wordmark, underline-on-active nav, icon-only cart | Centered serif wordmark, dot-separated text nav |
| Hero | Single rounded banner card, cover image with overlay | Asymmetric split: bold headline left, offset-framed photo right | Full-bleed immersive banner, large italic serif headline |
| Category nav | Pill buttons | Underlined bold-caps tabs | Centered thin-tracked text tabs |
| Menu presentation | Responsive card grid, expand-in-place for modifiers | Full-bleed photo tiles, name/price overlaid on the image | Editorial list: small thumbnail, hairline rule between rows |
| Footer | Centered, pill-shaped brand mark | Full-bleed dark band, bold caps | Generous whitespace, centered italic |
| Typography | Serif heading / sans body | Bold grotesque sans, everywhere, uppercase | Serif heading / serif body — a full "magazine" read |
| Radius / density | Soft / comfortable | Sharp / compact | Sharp / spacious |

Each theme also has its own default color palette and its own system font stack (no external font
loading — see "No network fonts" below). A restaurant can override branding within a theme (see
"What a restaurant can change") but cannot mix one theme's Header with another's Hero — the whole
component set is swapped together, which is what keeps each theme visually coherent instead of
becoming an unbounded combinatorial mess.

Classic matches the pre-Phase-31 storefront's exact visual language and is the default for every
restaurant that has never opened Theme Studio (`defaultRestaurantThemeConfig()`) — nothing changes
for an existing restaurant until its owner deliberately picks something else.

## Component contract: how presentation stays out of business logic

`apps/web/src/theme/types.ts` defines the prop interface for every themeable slot (`HeaderProps`,
`HeroProps`, `CategoryNavProps`, `MenuSectionProps`, `FeaturedProps`, `AboutProps`, `GalleryProps`,
`CtaProps`). `Layout.tsx` and `MenuPage.tsx` own **all** state and business logic — cart contents,
modifier selection, the add-to-cart flow, cart-conflict handling, scroll-spy, SEO/structured-data
injection, menu fetching — and hand a theme's components only fully-computed data and plain
callbacks (`onStartAdding`, `onConfirmAdd`, `onToggleOption`, ...). A theme component never imports
`CartContext`, never calls the API, and never makes an ordering decision. Swapping a restaurant's
theme can only ever change what the storefront *looks like*; it structurally cannot change what
happens when a customer places an order, because the components that render the theme have no way
to reach that code.

## What a restaurant can change

Via the admin Theme Studio (`apps/admin/src/pages/ThemeStudioPage.tsx`):

- **Theme** — pick one of the three.
- **Branding** — override `primary`/`secondary`/`accent`/`background` (hex only, validated both by
  the Zod schema server-side and the same regex client-side). A restaurant can never override the
  computed `-foreground` colors (a readable foreground is derived automatically via WCAG relative
  luminance — see `resolveThemeTokens.ts`'s `foregroundFor`) or the platform-fixed status colors
  (success/warning/danger stay consistent regardless of branding — a red error must never become a
  brand-colored "error").
- **Corner style / spacing** — `sharp | soft | rounded` and `compact | comfortable | spacious`,
  overriding the theme's own default.
- **Page sections** — `featured` (a short highlight strip), `about` (the restaurant's description as
  its own section), `gallery` (cover photo/logo), `cta` (a closing "ready to order?" prompt). All
  four default to **off** for any restaurant that hasn't explicitly turned them on — see "Section
  defaults are opt-in" below for why. `hero` is in the same `ThemeSectionKey` enum for
  forward-compatibility but is **not** exposed as a toggle in v1: it carries the open/closed
  availability status a customer needs to see, so it's never hidden.

Nothing else. There is no free-text CSS/JS field anywhere in this system — every control is a closed
enum or a hex color, so the persisted config can never smuggle in arbitrary styling or a script.

### Section defaults are opt-in, not opt-out

The first implementation defaulted every optional section to **shown**, reasoning that each section
already guards on the restaurant having the underlying data (a description, an image). That version
broke existing behavior in practice: the Featured section repeats item names that already appear in
the main menu grid, which is fine as a deliberate feature but is a real, visible change to a
storefront whose owner never touched Theme Studio. It was caught by an existing regression test
(`e2e/multi-tenant.spec.ts`) that suddenly had two matches for an item name that used to be unique.
The fix — and the correct rule going forward — is that **any restaurant on `sections: {}` (the
default, untouched config) renders exactly what it always has.** New sections are opt-in.

## Versioning

`RestaurantThemeConfig.themeVersion` records which version of the theme definition a restaurant's
config was last saved against. It exists for one reason: if a theme's own defaults or component
structure changes significantly in the future (not just a color, but "Modern v2" changing what
`density: "compact"` actually looks like), a stored config can be recognized as targeting an older
version and handled deliberately — either migrated or left alone — rather than silently
reinterpreted under new defaults the restaurant never saw or approved. Nothing currently reads this
field beyond storing and returning it; the mechanism is in place before it's needed, not before it's
possible to need.

## Draft vs. published — independent of the restaurant's own publish state

`Restaurant.settings.theme` (published) and `Restaurant.themeDraft` (unpublished edits) are
deliberately **independent** of the restaurant's own `status` field. A restaurant still finishing
setup (`status: "pending"`) can freely pick and publish a theme — publishing a *theme* and
publishing the *restaurant* are two different concepts. The restaurant's `status` remains the sole
gate on whether the public storefront is reachable at all; nothing here bypasses or duplicates that
gate.

- `GET /restaurants/:id/theme` → `{ published, draft, hasUnpublishedChanges }`
- `PATCH /restaurants/:id/theme/draft` → merges onto the current draft (or the published config, the
  first time); `colors`/`sections`, when present in the request, **replace** the baseline
  wholesale rather than merging field-by-field (see "Why colors/sections are full-replace, not
  field-merge" below).
- `POST /restaurants/:id/theme/publish` → copies the draft onto the published config, clears the
  draft, audit-logs `restaurant.theme_published`. Rejected with 400 if there's no draft to publish.
- `POST /restaurants/:id/theme/discard-draft` → reverts to the currently-published config.

All four routes require `requireTenantMatch()` + `requireTenantPermission("restaurant.settings.manage")`
— the agency-aware permission check (not the plain `requirePermission` most restaurant routes use),
because `agency_owner`/`agency_admin` already hold this permission via `AGENCY_ROLE_GRANTS` but
`agency_staff` (a read-only role platform-wide) does not, and that distinction needed to be honored
here too.

### Why colors/sections are full-replace, not field-merge

The first implementation merged `colors`/`sections` field-by-field onto the existing draft
(`{...baseline.colors, ...input.colors}`). This has no way to represent "clear this override back to
the theme default": `JSON.stringify` drops `undefined` keys, so sending `{colors: {}}` to clear every
override is indistinguishable, after a field-level merge, from "no color change at all" — the old
values silently stick around forever. This is a real bug the Theme Studio's own "Reset" button hit in
practice. The fix: `colors`/`sections`, when present in the request body at all, replace the
baseline's corresponding sub-object wholesale. Omitting the key entirely (not sending `colors` at
all) still preserves the existing baseline. This matches the Theme Studio's actual client behavior —
it always sends the complete current `colors`/`sections` object on every save, never a sparse
single-field delta — so this is both the fix and the more correct contract for how the only real
client actually works.

## Live preview reuses the real renderer

"Preview" in the Theme Studio opens `/r/:slug/preview` — the exact same route and the exact same
`MenuPage`/`Layout` components a real customer sees. There is no second, admin-only preview
renderer. The only difference is server-side: `previewRestaurantBySlug`
(`apps/api/src/controllers/restaurant.controller.ts`) substitutes the restaurant's draft theme in
place of its published one via `toPreviewRestaurant()`, for an authenticated request only
(owner/platform_admin, via `requireAuth`). The public `toPublicRestaurant()` path never even looks at
`themeDraft` — it isn't in the response shape at all, so there's no leak surface to audit for, only a
field that structurally doesn't exist in that response.

## Design tokens and the opacity-modifier fix

`packages/ui/src/theme/tokens.ts`'s `tokensToCssVars()` is the one function that knows the actual CSS
custom property names (`--color-primary`, `--radius-md`, ...); every theme/restaurant-override
consumer stays purely data-driven. `ThemeProvider` (`apps/web/src/components/ThemeProvider.tsx`)
resolves the active theme's tokens (`resolveThemeTokens`) and applies them via a `display: contents`
wrapper div, so it never affects layout — only descendants' computed CSS variables change.

Building the three themes surfaced a real, previously-latent bug in this pipeline: Tailwind's opacity
modifiers (`bg-primary/10`, `text-foreground/70`, ...) require a color to be defined as
`rgb(var(--x-rgb) / <alpha-value>)`, not a bare `var(--x)` hex string — otherwise Tailwind silently
fails to generate the utility class at all. This wasn't specific to the new theme code; it affected
every existing use of an opacity-modified semantic color throughout the app (the pre-Phase-31
`ItemThumb`'s gradient fallback included). The fix touches three places, all consistent with each
other:

- `apps/web/src/index.css`'s `:root` now defines a `--color-x-rgb` (space-separated decimal) variable
  alongside every existing `--color-x` hex variable.
- `apps/web/tailwind.config.js`'s color definitions use `rgb(var(--color-x-rgb) / <alpha-value>)`.
- `tokensToCssVars()` emits both the hex and `-rgb` forms for every runtime-overridden color, so a
  restaurant's custom theme colors get working opacity modifiers too, not just the static defaults.

## No network fonts

Each theme's `fonts.heading`/`fonts.body` (in its `ThemeDefinition`) is a system font stack, not a
Google Fonts/CDN reference — matching the app's existing "no FOUT, no network dependency" principle
(see `index.css`'s own note). Fonts are **not** restaurant-customizable in v1: each theme's
typographic personality (Classic's serif/sans pairing, Modern's bold all-sans, Editorial's all-serif)
is part of its identity, and opening it to arbitrary restaurant input would be both a design-quality
risk and, eventually, an injection-surface question not worth taking on for a feature this scoped.

## Security model

- Every persisted field is a closed enum (`THEME_KEYS`, `THEME_RADIUS_SCALES`, `THEME_DENSITIES`,
  `THEME_SECTION_KEYS`) or a `^#[0-9a-fA-F]{6}$`-validated hex color. There is no `z.any()` or
  passthrough anywhere in `packages/validation/src/theme.ts` — this can never accept or persist
  arbitrary CSS, JS, or an unbounded object.
- Authorization matches every other restaurant-settings route: owner, platform_admin, and an
  authorized agency admin (via `requireTenantPermission`) can manage a restaurant's theme;
  `agency_staff` and staff without `restaurant.settings.manage` cannot; a restaurant/business outside
  the caller's own tenant is rejected regardless of the restaurant ID supplied in the URL
  (`requireTenantMatch()` — restaurant IDs from the browser are never trusted on their own).
- The public storefront only ever reads `settings.theme` (published); the draft is never present in
  that response shape at all.

## Future compatibility

- **Phase 32 (interactive demo)**: the three themes are visually distinct enough that screenshots of
  them are usable in a sales/demo context today. No demo-specific infrastructure (anonymous
  preview sessions, a public theme gallery) was built in this phase — that's Phase 32's own scope.
- **Multilingual**: theme definitions describe presentation (layout, typography, spacing) only.
  No translatable copy lives in a `ThemeDefinition` or a `RestaurantThemeConfig` — the small amount
  of theme-authored microcopy that does exist (e.g. a hero CTA's exact wording, which differs per
  theme on purpose) lives in the theme's own component code, the same place all of this app's other
  UI strings live, not in persisted, restaurant-editable data. A future i18n layer applies to that
  code the same way it would to any other component.
- **AI-generated theming**: `RestaurantThemeConfig`'s closed-enum, hex-only shape means a future
  "AI-suggested branding" feature could only ever produce values this same strict schema already
  accepts — it has no path to emit arbitrary CSS/HTML/JS, because the schema doesn't have a slot for
  any of those to go.

## Testing

- **Jest** (`apps/api/src/controllers/theme.controller.test.ts`): the persisted config's defaults and
  validation, authorization (owner/staff/cross-tenant/agency-role matrix), the draft merge-and-clear
  behavior described above, preview-shows-draft/public-never-does, and the publish/discard flows.
- **Jest** (`apps/web/src/theme/*.test.ts`): the theme engine's pure, framework-independent logic —
  `resolveThemeTokens`'s override/foreground-derivation behavior, and the registry's own structural
  integrity (every theme has every required component, valid hex defaults, and its own distinct
  fonts/components — no accidental sharing between themes). This app has no existing
  React-rendering test infrastructure (no jsdom/`@testing-library` setup anywhere in the repo before
  this phase), so component *rendering* behavior is covered by Playwright instead, which exercises a
  real browser rather than a simulated DOM.
- **Playwright** (`e2e/storefront-theme.spec.ts`): the full draft → preview → publish → public
  lifecycle end to end, including that an unpublished draft never reaches the public storefront, that
  publishing makes it live for a genuinely anonymous visitor, and that changing one restaurant's
  theme never affects a different restaurant's storefront (tenant isolation). Runs as a single
  serial test with a `finally`-block cleanup via direct API calls (not by re-driving the admin UI —
  a preview page sharing its refresh-token cookie with the admin session can rotate the admin
  session's own token out from under it, a narrow cross-origin local-dev interaction worth avoiding
  rather than fighting), reverting the shared `demo-restaurant` fixture to a clean Classic baseline
  regardless of pass/fail, since other existing specs render against that same fixture.
- **Jest** (`apps/api/src/controllers/demoPlayground.test.ts`, Phase 32): `POST /auth/demo-session`'s
  response shape, that a placed order is server-flagged `isDemo` regardless of client input, and that
  `listRestaurantOrders`/`getRestaurantAnalytics` both exclude demo orders while leaving real ones
  untouched. **Jest** (`apps/web/src/theme/resolveActiveConfig.test.ts`, Phase 32): the slug-matching
  guard behind `ThemeOverrideContext` — the override applies only when captured for the restaurant
  currently being rendered.
- **Playwright** (`e2e/experience-playground.spec.ts`, Phase 32, updated Phase 33): live theme/color/
  section customization and device-width switching on `/r/:slug/experience`, a real add-to-cart-and-
  checkout through an ephemeral demo session, that the resulting order is invisible on the real
  owner's Orders Management page, and that a separate browser context never inherits another
  visitor's customization. Needs no shared-state cleanup (the override never touches the database,
  and the order it places is real but correctly excluded from every staff-facing view by `isDemo`).
  Updated for Phase 33 to add-to-cart on Cinematic (the playground's default seed theme) and switch
  to Minimal, replacing the retired Editorial-specific fingerprint.
- **Jest** (`apps/web/src/theme/registry.test.ts`, extended Phase 33): all eight registry entries
  (three legacy + five current) have real, distinct components/fonts/`styleTags`/motion intensities;
  the five current directions specifically each have a unique heading font (the assertion that would
  have caught, and did catch during development, the Contemporary/Urban duplicate-font bug above).
- **Playwright** (`e2e/storefront-theme.spec.ts`, updated Phase 33): switches to Cinematic instead of
  the now-unlisted Editorial when driving Theme Studio's picker UI, using Cinematic's own
  `"Reserve the menu"`/`"View the menu"` copy as the structural fingerprint in place of the old
  "View the menu appears twice" trick — the underlying draft/preview/publish/tenant-isolation
  behavior under test is unchanged.

## Phase 32 — the public demo playground

`/r/:restaurantSlug/experience` (new, additive route alongside the existing `/r/:slug/preview`) lets
an anonymous visitor live-switch and customize a theme against the seeded `demo-restaurant`, using
this exact engine — not a fork of it. Two small, deliberately narrow additions make this possible
without touching anything above:

- **`ThemeOverrideContext`** (`apps/web/src/theme/ThemeOverrideContext.tsx`) — a client-only,
  `sessionStorage`-backed `{slug, config: RestaurantThemeConfig}` pair. `ThemeProvider` prefers it
  over `restaurant.settings.theme` (via the pure, unit-tested `resolveActiveThemeConfig` in
  `resolveActiveConfig.ts`) **only when its `slug` matches the restaurant currently being rendered**
  — without that guard, a same-tab client-side navigation to an unrelated restaurant would inherit a
  stale override, since React context state survives a route change that isn't a full reload. Nothing
  in this path ever calls the draft/publish/discard endpoints above — a playground visitor can never
  mutate the real restaurant's persisted theme, and `sessionStorage`'s native per-tab scoping is the
  entire mechanism behind one visitor's customization never leaking to another's.
- **A client-only QR code** (`apps/web/src/pages/experience/QrPanel.tsx`) generated with the same
  `qrcode` package `qr.service.ts` already uses server-side for real table QR codes — run here in the
  browser instead, encoding only the current page's own URL, needing no new backend endpoint.

Everything else on the experience page (the menu, modifiers, cart, checkout) is the literal,
unmodified `MenuPage`/`CartContext`/`CartPage` — the plain `/r/:slug` route these normally live on is
completely untouched by any of this.

**Safe demo ordering**: placing a real order from the playground needs a real authenticated session
(`createOrder` hard-requires `requireAuth`), so `POST /auth/demo-session` mints a throwaway,
`isDemoAccount:true` customer — no credentials, same `{user, accessToken}` response shape
`login`/`register` return, so nothing downstream (`CartPage.placeOrder`) needs to special-case it.
`createOrder` re-derives `Order.isDemo` from that session flag server-side (never trusts the client),
and `listRestaurantOrders` (backing both Kitchen Display and Orders Management),
`analytics.service.ts`'s aggregates, and `platform.controller.ts`'s restaurant/platform-wide order
counts all exclude `isDemo:true` by default — a public playground visitor's order is real (goes
through the same server-authoritative pricing/tax/loyalty pipeline, via whichever `PAYMENT_PROVIDER`
is configured — `mock` by default, so no real money ever moves) but invisible to the restaurant's real
staff. `apps/api/src/scripts/cleanupDemoData.ts` (run externally, like every other maintenance script
here — this repo has no in-process cron) deletes expired demo accounts and their orders/payments.

## Phase 33 — the premium theme collection

Phase 31's three themes were architecturally correct but visually generic — closer to a React
template than a premium restaurant website. Phase 33 is a visual-design phase, not an architecture
change: five new, genuinely distinct art-directed systems (**Cinematic, Luxury, Contemporary, Urban,
Minimal**), each with its own composition, typography, navigation behavior, menu presentation, image
treatment, and motion language — built entirely inside Phase 31's existing component contract. See
`docs/premium-storefront-design-research.md` for the design research behind the five directions.

### Why Classic/Modern/Editorial were kept, not deleted or aliased

The first implementation of this phase deleted the three original theme folders and added a
`LEGACY_THEME_KEY_ALIASES` map so a restaurant's persisted `themeKey:"classic"` would resolve, for
rendering, to Luxury (Modern→Urban, Editorial→Minimal). This was reverted after tracing the actual
blast radius: 18+ existing Playwright specs assert on Classic's *exact* structural fingerprint —
`"Add to cart"`/`"Start your order"` button text, the presence/absence of specific sections, DOM
shape — none of which the new themes reproduce, deliberately, since being genuinely different is the
entire point of Phase 33. Aliasing `themeKey` to a differently-worded theme would have silently
broken those specs' assumptions about what the shared `demo-restaurant`/`spice-route`/`bella-vista`
fixtures render as.

The correct fix, and the one actually shipped: **`THEME_REGISTRY` keeps all eight entries** —
Classic/Modern/Editorial exactly as they were, plus the five new ones. An existing restaurant's
persisted `themeKey` renders *exactly* what it always has — true zero-regression safety, not a
hopeful alias mapping to a theme with different copy. Going forward, Theme Studio's picker
(`apps/admin/src/lib/themeCatalog.ts`) and the demo playground's picker (`PlaygroundPanel.tsx`'s
`PLAYGROUND_THEME_KEYS`) both intentionally list **only the five current directions** — Classic/
Modern/Editorial are legacy-safety entries in the registry, not part of the collection being
promoted or sold. Nothing changes for a restaurant that never opens Theme Studio; nothing new is
ever silently assigned to it.

### The five new directions

| | **Cinematic** | **Luxury** | **Contemporary** | **Urban** | **Minimal** |
|---|---|---|---|---|---|
| Signature | A restaurant-film website, not an app | Quality through restraint | Designed by a digital art director | Energetic street-food/modern-casual | The absence of visual noise is the design |
| Hero | Viewport-height full-bleed photo, type sitting directly on the image, transparent nav that solidifies on scroll | Asymmetric editorial two-column: large image, restrained serif text block | Genuine split-viewport, oversized type off-grid-staggered top/bottom | Bold dark panel + layered offset photo collage, real-data corner tags | Enormous whitespace, small precise type, restrained/no imagery |
| Menu | Full-width horizontal photo rows, no card grid | Elegant hairline-ruled typography rows, no photos at all, price in its own right column | Asymmetric rows with oversized ghost index numbers, offset images | Dense numbered rows, real-data "N options to customize" tags, bold color blocks | Text-first rows with a dotted price leader, small sparing imagery |
| Motion | `expressive` — slow mask reveals | `subtle` — quiet opacity-only fades | `expressive` — scale/offset transitions | `expressive` — punchy, staggered | `subtle` — near-silent opacity fades |
| Mobile anchor | Still full-bleed and dramatic, compact floating nav | Image-leading stack, spacing preserved not compressed | Off-grid relationships preserved at narrow widths | Persistent bottom-sticky order bar (its headline mobile feature) | Whitespace scales proportionally, no dense stacking |

Token additions supporting these (`packages/types/src/types/theme.ts`, `apps/web/src/theme/types.ts`)
— deliberately small, since the brief explicitly warns against an over-engineered token system;
everything else that makes a theme distinct is expressed directly in that theme's own component
Tailwind classes, exactly how Phase 31's three themes already differed:
- `ThemeTokens.overlayOpacity?: number` — Cinematic's consistent dark-overlay-over-imagery value;
  other themes simply never read it.
- `ThemeDefinition.motion: { intensity: "subtle" | "standard" | "expressive" }` — read by `Reveal`'s
  callers to pick a variant matching the theme's own motion register.
- `ThemeDefinition.styleTags: string[]` — display-only chips for the Theme Studio/demo-playground
  picker cards (e.g. `["Immersive", "Dramatic", "Image-led"]`); never read by the storefront renderer.

`RestaurantThemeConfig` (the persisted, owner-editable surface) is completely unchanged — no backend
schema restructuring. The one real backend touch: `apps/api/src/models/Restaurant.ts` hardcodes its
own local `THEME_KEYS` array as the Mongoose enum gate on `settings.theme.themeKey` (a pre-existing
duplication of `packages/types`' own `THEME_KEYS`, not refactored away here) — both were widened from
3 to 8 values so Theme Studio can persist the five new keys.

### Motion: `Reveal`'s `variant` prop, and a real IntersectionObserver bug found and fixed

`packages/ui/src/theme/Reveal.tsx` gained a `variant?: "fade-up" | "fade" | "mask" | "scale"` prop
(default `"fade-up"`, Phase 31's original behavior unchanged) with matching CSS in
`apps/web/src/index.css`. All four are transform/opacity/clip-path-only CSS transitions — no new
animation dependency — and all are neutralized under `prefers-reduced-motion`.

Building Cinematic's mask-revealed Featured image surfaced a genuine, non-obvious browser bug:
**an element clipped to zero visible area via `clip-path` (`inset(0 0 100% 0)`, the "hidden" state
before a reveal) is reported by Chromium's `IntersectionObserver` as having a 0% intersection ratio,
even though the element's actual layout geometry (`getBoundingClientRect`) is completely unaffected.**
A `variant="mask"` `Reveal` that puts `clip-path` directly on the *observed* element therefore
deadlocks — it can never observe itself as "visible" while still fully clipped, since the very
property meant to visually reveal it makes the browser think it isn't on screen at all. Confirmed by
scrolling a real element through generous, centered, multi-second-dwell viewport positions and
watching it stay permanently unrevealed; fixed by removing `clip-path` and confirming the same
element became visible immediately.

The fix: `variant="mask"` now renders an **inner wrapper** that carries the clip-path animation,
while the *outer*, `ref`-observed element never has `clip-path` applied to it at all — the observer
sees a normal, always-fully-visible-geometry element, and the visual wipe happens on a child it has
no opinion about. This is a shared-infrastructure fix (`packages/ui`), so every current and future
`variant="mask"` usage across every theme benefits from it, not just Cinematic's.

### Real bugs found during the visual review (Design Director Review gate)

Automated tests passing was treated as a floor, not the gate — every theme was screenshotted at
desktop (1280/1440) and mobile (390) widths and inspected in a real browser before being considered
done. This surfaced several real, now-fixed bugs beyond the IntersectionObserver one above:

- **A stale Tailwind config, session-wide.** The running `apps/web` Vite dev server had been serving
  a cached/stale compiled Tailwind bundle where every opacity-modifier utility (`bg-primary/10`,
  `text-secondary-foreground/70`, ...) fell back to a flat, non-opacity color — silently breaking any
  translucent text/background across *every* theme, not just the new ones, for the lifetime of that
  dev server process. Diagnosed by inspecting `document.styleSheets` directly for the generated
  `.text-secondary-foreground` rule and finding `color: var(--color-secondary-foreground)` instead
  of the expected `rgb(var(--color-secondary-foreground-rgb) / <alpha-value>)` pattern; fixed by
  restarting the dev server. Not a code bug — a reminder that `tailwind.config.js` changes need a dev
  server restart to take effect, unlike ordinary source-file HMR.
- **A cover image with text baked directly into the SVG artwork** (from Phase 32's demo-restaurant
  seed backfill) visually collided with Cinematic's hero, which — unlike the three original themes —
  puts real typography directly on top of the full-bleed photo. Fixed by removing the baked `<text>`
  elements from the SVG; images must only ever be images, with all real content coming from
  components, never assumed "safe" text-free background art.
- **Two themes (Contemporary and Urban) were accidentally given the identical heading font stack** —
  caught by `registry.test.ts`'s own "every theme has its own font stack" assertion, which is exactly
  the kind of distinctness regression that test exists to catch.
- **Urban's hero headline could overflow its grid column and render clipped** for a longer restaurant
  name at an oversized display size — fixed with `min-w-0` on the grid item (a real CSS Grid
  gotcha: a flex/grid item's content can overflow its own track unless explicitly allowed to shrink)
  plus a `break-words` safety net and a slightly smaller type scale.

### Theme Studio and demo playground

`apps/admin/src/lib/themeCatalog.ts` now lists only the five current directions (key/name/
description/`styleTags`/swatch), and `ThemeStudioPage.tsx`'s picker cards show each theme's
style-tag row (e.g. `CINEMATIC — Immersive · Dramatic · Image-led`). The Phase 32 demo playground
(`PlaygroundPanel.tsx`) similarly restricts its cards to the same five keys (`PLAYGROUND_THEME_KEYS`)
rather than showing all eight registry entries — the playground exists to sell the premium
collection, not to also surface the legacy-safety entries. Its "seed from the restaurant's real
theme" logic falls back to Cinematic when the real theme is a legacy key not in that five-key list,
so the playground always opens with a real, current card highlighted.

## What this phase did not build

- Business-level theme inheritance (see "Ownership" above).
- A restaurant-facing way to reorder sections or add new section types beyond the four exposed.
- Restaurant-customizable fonts.
- A DB-backed, generically-editable system configuration surface — unrelated to this phase, noted
  here only because it's the kind of scope this phase deliberately did not expand into either.
- Product/event-tracking analytics (demo_started, theme_changed, etc.) for the Phase 32 playground —
  no event-tracking SDK or generic event-log pattern exists anywhere in this codebase to extend.
- A sixth theme direction (Phase 33) — the brief explicitly asked not to add one merely to hit a
  round number; five genuine directions was the target, not a count.
