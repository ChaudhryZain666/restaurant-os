import type { ThemeColorTokens, ThemeKey } from "@restaurant/types";

/**
 * Phase 31 — display-only metadata for the Theme Studio's picker cards (name, plain-language
 * description, swatch colors). The admin app never imports the actual theme components — those
 * are storefront-rendering code and stay in `apps/web/src/theme/registry.tsx`, which is the real
 * source of truth this is kept in sync with by hand. Duplicating just this display metadata (never
 * the components, never business logic) is what keeps "Theme Definition" a code-only, developer-
 * controlled layer that the admin app can describe without being able to render or mutate it.
 *
 * Phase 33 added five new directions (Cinematic/Luxury/Contemporary/Urban/Minimal) alongside the
 * three from Phase 31 (Classic/Modern/Editorial). Phase 41 — restored the three Phase 31 entries to
 * this catalog: they had been dropped when Phase 33 shipped, which meant the platform's own
 * protected default theme (Classic) was fully implemented and selectable via the API, but had no
 * path to select it from the Theme Studio UI at all — an owner could only reach it via a raw API
 * call. There is no `LEGACY_THEME_KEY_ALIASES` remapping mechanism; all eight keys are simply real,
 * independently valid theme selections. `styleTags` mirror each theme's real
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
  {
    key: "classic",
    name: "Classic",
    description: "Warm and familiar — a rounded banner, pill navigation, and a friendly card grid. The traditional restaurant-website register. The platform's protected default theme.",
    styleTags: ["Traditional", "Friendly", "Familiar"],
    swatch: { primary: "#c2410c", secondary: "#292524", accent: "#b45309", background: "#fbf9f7" },
  },
  {
    key: "modern",
    name: "Modern",
    description: "Bold and high-contrast — an asymmetric split hero, sharp edges, full-bleed photo tiles. A confident, editorial-brand register.",
    styleTags: ["Bold", "High-contrast", "Confident"],
    swatch: { primary: "#dc2626", secondary: "#111111", accent: "#f59e0b", background: "#ffffff" },
  },
  {
    key: "editorial",
    name: "Editorial",
    description: "Quiet and refined — a full-bleed immersive banner, a magazine-style list menu, generous whitespace. A magazine-front-page register.",
    styleTags: ["Quiet", "Refined", "Spacious"],
    swatch: { primary: "#44403c", secondary: "#1c1917", accent: "#92400e", background: "#faf7f2" },
  },
];
