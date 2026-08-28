# Premium Storefront Design Research (Phase 33)

## Purpose

Before touching any theme component, this phase started with design reconnaissance: what actually
makes a restaurant/hospitality website read as premium, versus merely "styled." This document
records the findings and, in each section, how they were translated into the five-theme collection
(`apps/web/src/theme/{cinematic,luxury,contemporary,urban,minimal}`). Nothing here copies a specific
site's layout, assets, text, or branding — the goal was to extract *patterns*, then design five
original compositions from them.

## 1. Design patterns discovered

- **Editorial restraint beats flashy animation.** Award-tier restaurant/hospitality sites (the
  Michelin/James-Beard tier) lean on cross-fading, high-quality photography and quiet typographic
  pacing rather than parallax, video backgrounds, or heavy motion. Premium reads as *confidence*, not
  *activity*.
- **The food (or the space) does the selling.** High-contrast photography with the dish or interior
  as the sole focal point, shot against a clean/neutral background, consistently outperforms
  decorative UI chrome — badges, ribbons, colored cards — as the actual driver of appetite appeal.
- **Serif headline + clean sans body** is the dominant premium/heritage pairing across luxury
  hospitality; a dramatic high-contrast serif paired with a quiet, legible sans body reads as
  "considered" without needing ornamentation.
- **Whitespace and thin rules, not boxes and shadows, signal quality.** Boutique-hotel-tier sites
  borrow directly from editorial magazine layout: generous negative space, hairline dividers, and
  restrained color palettes carry the "expensive" feeling — rounded cards with drop shadows read as
  generic SaaS/template output, not hospitality.
- **Menu presentation favors clear hierarchy over decoration.** The best menu UIs are grids or lists
  with a strong, legible price/name/description hierarchy and generous negative space — not every
  item needing its own card or icon.
- **Motion, where used, is purposeful and brief.** Micro-interactions under ~300ms, transform/opacity
  only (never layout-triggering properties), always paired with a `prefers-reduced-motion` fallback.
  Parallax is used sparingly, if at all, on the highest-end sites.
- **Mobile gets a dedicated, sticky path to ordering.** A persistent bottom (or clearly anchored) "Order"
  action is the single highest-leverage mobile pattern across restaurant-ordering UX research — mobile
  is not "the desktop layout, narrower."

## 2. Common patterns worth adopting

- Full-bleed, high-contrast photography as the primary hero content (not a decorative backdrop behind
  a card).
- Real typographic hierarchy (display/heading/body/caption scale) expressed through genuine size and
  weight relationships, not just "make the heading bigger."
- Thin hairline rules as a structural device, replacing card borders/shadows.
- A menu that reads more like an edited list than an app's product grid — price and name given equal
  typographic weight, description subordinate.
- A sticky, purposeful mobile ordering CTA.
- Motion that supports a single compositional idea per theme (a mask-reveal for photography, a quiet
  fade for restraint, a scale/offset for a bolder register) rather than a generic "everything fades up."

## 3. Patterns to avoid

- The generic SaaS composition: *header → hero card with centered heading and badges → three-card
  row → pill category nav → menu-card grid → three-card row → CTA card → footer* — recolored, this
  is still the same website. None of the five themes use this shape.
- Rounded cards with drop shadows as the default container for everything.
- Pill-shaped buttons as a universal default (four of the five themes explicitly avoid them for
  primary actions).
- Decorative gradients, "glassmorphism," or blobs used to manufacture visual interest in an otherwise
  flat composition.
- Animation used to *compensate* for a plain layout rather than to support a real compositional idea.
- Treating mobile as "the desktop layout, shrunk and stacked."

## 4. Typography observations

Each theme picks a genuine, real system-font pairing (no network font loading — see
`docs/theme-architecture.md`'s existing note on this) that carries its own identity: a warm serif for
Luxury's editorial register, a large confident serif/condensed pairing for Cinematic's cinematic
scale, oversized display type for Contemporary, bold condensed/uppercase for Urban's energetic
register, and a quiet, precise type choice for Minimal where hierarchy comes from spacing discipline
rather than decoration. Hierarchy is expressed through real scale/weight/letter-spacing relationships
per theme, not a single shared type-ramp reused everywhere.

## 5. Hero observations

The hero is the single highest-leverage section for "theme identity within ~3 seconds." Each of the
five themes uses a **structurally different** hero composition — full-bleed viewport-height imagery
with type sitting directly on the photograph (Cinematic); an asymmetric editorial two-column split
(Luxury); an oversized-typography split-viewport composition (Contemporary); bold graphic blocks and
layered imagery (Urban); enormous whitespace with restrained, precisely-cropped imagery (Minimal). No
two share a centered-heading-over-a-card shape.

## 6. Menu observations

The menu is the actual product and got the most design attention of any section. Every theme still
supports the full functional contract — categories, prices, descriptions, images, modifier group
selection, special instructions, add-to-cart, quantity, and the ordering-closed state — but the
*presentation* differs completely: full-width photography rows (Cinematic), elegant hairline-ruled
typography rows with right-aligned pricing (Luxury), asymmetric compositions with oversized floating
index/price numbers (Contemporary), bold dense rows with graphic labels (Urban), and quiet text-first
rows with small, sparing imagery (Minimal).

## 7. Navigation observations

Every theme's header stays `position: sticky` (never `fixed`) so it reserves its own layout space —
a fixed/overlaid header would require the shared `Layout.tsx` component (used by all five themes and
every other page in the app) to add clearance for it on every non-hero page, which a single theme
must never force on the rest of the app. Themes that want a transparent-over-hero look (Cinematic)
achieve it by having the Hero section itself pull up over `<main>`'s own padding and the header's
rendered height via a negative margin, so the image visually extends behind the header's sticky box
while the header still occupies real, predictable flow space everywhere else.

## 8. Motion observations

`packages/ui/src/theme/Reveal.tsx` was extended with a `variant` prop (`fade-up` | `fade` | `mask` |
`scale`) rather than adding a new animation dependency — everything is a CSS transform/opacity/
clip-path transition, matching the research finding that premium sites keep motion purposeful and
cheap. `ThemeDefinition.motion.intensity` (`subtle` | `standard` | `expressive`) lets each theme
declare its own motion register without every component re-deriving timing values. One real bug was
found and fixed here: a `clip-path`-driven reveal (`variant="mask"`) that clips an element to zero
visible area in its *hidden* state is reported by Chromium's `IntersectionObserver` as having 0%
intersection ratio even though the element's layout geometry is unaffected — this deadlocks the
reveal (it can never observe itself as visible while still fully clipped). The fix moves the
clip-path animation to an inner wrapper, never the observed element itself.

## 9. Mobile observations

Each theme has a distinct, deliberate mobile composition rather than a shared collapse pattern:
Cinematic keeps its imagery full-bleed and dramatic with a compact floating nav; Luxury stacks its
hero with the image leading and preserves its generous spacing rather than compressing it; Contemporary
preserves its off-grid, oversized-type relationships at narrow widths; Urban's headline mobile feature
is a persistent bottom-sticky order bar; Minimal's whitespace scales down proportionally rather than
collapsing into a dense generic stack.

## 10. Accessibility observations

Every theme keeps the existing platform-wide guarantees intact: semantic headings, real `<button>`/
`<label>` elements for every interactive control (never a `<div onClick>`), visible focus states
(inherited from the shared base styles), image `alt` text left empty/decorative only where the image
is genuinely decorative (never on content-bearing imagery), and `Reveal`'s existing
`prefers-reduced-motion` handling — reduced motion neutralizes every reveal variant to an instant,
fully-visible state (see `apps/web/src/index.css`'s reduced-motion block), never leaving content stuck
hidden.

## 11. Performance considerations

No new npm dependency was added for motion or layout — every effect is CSS transform/opacity/
clip-path, GPU-cheap, and reuses the existing `IntersectionObserver`-driven `Reveal` primitive. Images
continue to use the existing `loading="lazy"` convention for below-the-fold content. No theme
introduces additional API calls, additional client-side routing, or a second rendering pipeline —
every theme is still driven entirely by `MenuPage`'s existing single menu fetch.

## 12. How this translates into the five themes

See `docs/theme-architecture.md`'s "Phase 33 — the premium theme collection" section for the concrete
per-theme composition specs and the architecture (registry keys, legacy-key aliasing, token
additions) built on top of these findings.
