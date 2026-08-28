import type { ThemeColorTokens, ThemeKey } from "@restaurant/types";

/**
 * Phase 31 — display-only metadata for the Theme Studio's picker cards (name, plain-language
 * description, swatch colors). The admin app never imports the actual theme components — those
 * are storefront-rendering code and stay in `apps/web/src/theme/registry.tsx`, which is the real
 * source of truth this is kept in sync with by hand. Duplicating just this display metadata (never
 * the components, never business logic) is what keeps "Theme Definition" a code-only, developer-
 * controlled layer that the admin app can describe without being able to render or mutate it.
 *
 * Phase 33 — rebuilt around the five current directions (Cinematic/Luxury/Contemporary/Urban/
 * Minimal), replacing Classic/Modern/Editorial (still valid, persisted `themeKey` values — see
 * registry.tsx's LEGACY_THEME_KEY_ALIASES — but no longer offered here, since Theme Studio only
 * ever *writes* one of the five current keys going forward). `styleTags` mirror each theme's real
 * `ThemeDefinition.styleTags` in apps/web's registry.
 */
export interface ThemeCatalogEntry {
  key: ThemeKey;
  name: string;
  description: string;
  styleTags: string[];
  swatch: Pick<ThemeColorTokens, "primary" | "secondary" | "accent" | "background">;
}

export const THEME_CATALOG: ThemeCatalogEntry[] = [
  {
    key: "cinematic",
    name: "Cinematic",
    description: "Immersive and dramatic — a viewport-height photographic hero, typography sitting directly on the image, a transparent nav that solidifies on scroll. A restaurant-film register, not an app.",
    styleTags: ["Immersive", "Dramatic", "Image-led"],
    swatch: { primary: "#c8933e", secondary: "#15130f", accent: "#7a2e2e", background: "#faf8f4" },
  },
  {
    key: "luxury",
    name: "Luxury",
    description: "Elegant and editorial — sophisticated serif typography, thin hairline rules instead of cards, generous whitespace, understated text-only CTAs. Quality communicated through restraint, not decoration.",
    styleTags: ["Elegant", "Editorial", "Refined"],
    swatch: { primary: "#6b2d3c", secondary: "#2b2420", accent: "#a8823c", background: "#faf7f2" },
  },
  {
    key: "contemporary",
    name: "Contemporary",
    description: "Experimental and bold — an asymmetric split-viewport hero, oversized display typography, off-grid alignment, floating price/index numbers. Designed by a digital art director, not a template.",
    styleTags: ["Experimental", "Bold", "Artistic"],
    swatch: { primary: "#d7263d", secondary: "#0a0a0a", accent: "#f2b705", background: "#ffffff" },
  },
  {
    key: "urban",
    name: "Urban",
    description: "Energetic and graphic — bold condensed type, solid color blocks, dense numbered menu rows, a mobile-first sticky order bar. Built for premium street-food, pizza, burgers, and modern-casual brands.",
    styleTags: ["Energetic", "Graphic", "Modern"],
    swatch: { primary: "#ff4d00", secondary: "#141414", accent: "#ffd23f", background: "#fafaf9" },
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Calm and precise — enormous whitespace, a text-first dotted-leader menu, near-silent motion, no shadows, no cards. The absence of visual noise is the design.",
    styleTags: ["Calm", "Refined", "Precise"],
    swatch: { primary: "#5b5347", secondary: "#1c1a17", accent: "#8a7a5c", background: "#ffffff" },
  },
];
