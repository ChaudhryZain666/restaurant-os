import type { ThemeColorTokens, ThemeKey } from "@restaurant/types";

/**
 * Phase 31 — display-only metadata for the Theme Studio's picker cards (name, plain-language
 * description, swatch colors). The admin app never imports the actual theme components — those
 * are storefront-rendering code and stay in `apps/web/src/theme/registry.tsx`, which is the real
 * source of truth this is kept in sync with by hand. Duplicating just this display metadata (never
 * the components, never business logic) is what keeps "Theme Definition" a code-only, developer-
 * controlled layer that the admin app can describe without being able to render or mutate it.
 */
export interface ThemeCatalogEntry {
  key: ThemeKey;
  name: string;
  description: string;
  swatch: Pick<ThemeColorTokens, "primary" | "secondary" | "accent" | "background">;
}

export const THEME_CATALOG: ThemeCatalogEntry[] = [
  {
    key: "classic",
    name: "Classic",
    description: "Warm and familiar — a rounded banner, pill navigation, and a friendly card grid. The traditional restaurant-website register.",
    swatch: { primary: "#c2410c", secondary: "#292524", accent: "#b45309", background: "#fbf9f7" },
  },
  {
    key: "modern",
    name: "Modern",
    description: "Bold and high-contrast — an asymmetric split hero, sharp edges, full-bleed photo tiles. A confident, editorial-brand register.",
    swatch: { primary: "#dc2626", secondary: "#111111", accent: "#f59e0b", background: "#ffffff" },
  },
  {
    key: "editorial",
    name: "Editorial",
    description: "Quiet and refined — a full-bleed immersive banner, a magazine-style list menu, generous whitespace. A magazine-front-page register.",
    swatch: { primary: "#44403c", secondary: "#1c1917", accent: "#92400e", background: "#faf7f2" },
  },
];
