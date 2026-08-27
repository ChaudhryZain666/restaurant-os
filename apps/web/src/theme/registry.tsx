import type { ThemeDefinition } from "./types";
import { ClassicHeader } from "./classic/Header";
import { ClassicFooter } from "./classic/Footer";
import { ClassicHero } from "./classic/Hero";
import { ClassicCategoryNav } from "./classic/CategoryNav";
import { ClassicMenuSection } from "./classic/MenuSection";
import { ClassicFeatured, ClassicAbout, ClassicGallery, ClassicCta } from "./classic/Sections";
import { ModernHeader } from "./modern/Header";
import { ModernFooter } from "./modern/Footer";
import { ModernHero } from "./modern/Hero";
import { ModernCategoryNav } from "./modern/CategoryNav";
import { ModernMenuSection } from "./modern/MenuSection";
import { ModernFeatured, ModernAbout, ModernGallery, ModernCta } from "./modern/Sections";
import { EditorialHeader } from "./editorial/Header";
import { EditorialFooter } from "./editorial/Footer";
import { EditorialHero } from "./editorial/Hero";
import { EditorialCategoryNav } from "./editorial/CategoryNav";
import { EditorialMenuSection } from "./editorial/MenuSection";
import { EditorialFeatured, EditorialAbout, EditorialGallery, EditorialCta } from "./editorial/Sections";

/**
 * Phase 31 — the theme definition registry: which themes exist, their default tokens, and which
 * component implements each part of the storefront. This is the ONE place a new theme is added;
 * MenuPage/Layout never branch on `themeKey` directly, they only ever consume `useActiveTheme()`'s
 * resolved `components`/`tokens` (see useActiveTheme.ts). Never persisted — see
 * docs/theme-architecture.md's three-layer split.
 */
export const THEME_REGISTRY: Record<string, ThemeDefinition> = {
  classic: {
    key: "classic",
    name: "Classic",
    description: "Warm and familiar — a rounded banner, pill navigation, and a friendly card grid. The traditional restaurant-website register.",
    defaultTokens: {
      colors: {
        primary: "#c2410c",
        primaryForeground: "#fffaf5",
        secondary: "#292524",
        secondaryForeground: "#fafaf9",
        accent: "#b45309",
        accentForeground: "#fffaf5",
        background: "#fbf9f7",
        surface: "#ffffff",
        foreground: "#1c1917",
        muted: "#78716c",
        border: "#e7e2dc",
      },
      radius: "soft",
      density: "comfortable",
    },
    fonts: {
      heading: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: ClassicHeader,
      Footer: ClassicFooter,
      Hero: ClassicHero,
      CategoryNav: ClassicCategoryNav,
      MenuSection: ClassicMenuSection,
      Featured: ClassicFeatured,
      About: ClassicAbout,
      Gallery: ClassicGallery,
      Cta: ClassicCta,
    },
  },
  modern: {
    key: "modern",
    name: "Modern",
    description: "Bold and high-contrast — an asymmetric split hero, sharp edges, full-bleed photo tiles. A confident, editorial-brand register.",
    defaultTokens: {
      colors: {
        primary: "#dc2626",
        primaryForeground: "#ffffff",
        secondary: "#111111",
        secondaryForeground: "#ffffff",
        accent: "#f59e0b",
        accentForeground: "#111111",
        background: "#ffffff",
        surface: "#ffffff",
        foreground: "#0a0a0a",
        muted: "#525252",
        border: "#0a0a0a",
      },
      radius: "sharp",
      density: "compact",
    },
    fonts: {
      heading: '"Helvetica Neue", Helvetica, Arial, sans-serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: ModernHeader,
      Footer: ModernFooter,
      Hero: ModernHero,
      CategoryNav: ModernCategoryNav,
      MenuSection: ModernMenuSection,
      Featured: ModernFeatured,
      About: ModernAbout,
      Gallery: ModernGallery,
      Cta: ModernCta,
    },
  },
  editorial: {
    key: "editorial",
    name: "Editorial",
    description: "Quiet and refined — a full-bleed immersive banner, a magazine-style list menu, generous whitespace. A magazine-front-page register.",
    defaultTokens: {
      colors: {
        primary: "#44403c",
        primaryForeground: "#fafaf9",
        secondary: "#1c1917",
        secondaryForeground: "#fafaf9",
        accent: "#92400e",
        accentForeground: "#fffbeb",
        background: "#faf7f2",
        surface: "#ffffff",
        foreground: "#292524",
        muted: "#78716c",
        border: "#e7e2dc",
      },
      radius: "sharp",
      density: "spacious",
    },
    fonts: {
      heading: 'Georgia, "Times New Roman", Times, serif',
      body: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, Georgia, serif',
    },
    components: {
      Header: EditorialHeader,
      Footer: EditorialFooter,
      Hero: EditorialHero,
      CategoryNav: EditorialCategoryNav,
      MenuSection: EditorialMenuSection,
      Featured: EditorialFeatured,
      About: EditorialAbout,
      Gallery: EditorialGallery,
      Cta: EditorialCta,
    },
  },
};

export const DEFAULT_THEME_KEY = "classic";

export function getThemeDefinition(themeKey: string): ThemeDefinition {
  return THEME_REGISTRY[themeKey] ?? THEME_REGISTRY[DEFAULT_THEME_KEY];
}
