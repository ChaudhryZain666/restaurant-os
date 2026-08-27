# Storefront Theme Architecture (Phase 31)

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

## The three themes

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

## What this phase did not build

- Business-level theme inheritance (see "Ownership" above).
- A restaurant-facing way to reorder sections or add new section types beyond the four exposed.
- Restaurant-customizable fonts.
- Any Phase-32-specific demo infrastructure.
- A DB-backed, generically-editable system configuration surface — unrelated to this phase, noted
  here only because it's the kind of scope this phase deliberately did not expand into either.
