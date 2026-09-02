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
import { CinematicHeader } from "./cinematic/Header";
import { CinematicFooter } from "./cinematic/Footer";
import { CinematicHero } from "./cinematic/Hero";
import { CinematicCategoryNav } from "./cinematic/CategoryNav";
import { CinematicMenuSection } from "./cinematic/MenuSection";
import { CinematicFeatured, CinematicAbout, CinematicGallery, CinematicCta } from "./cinematic/Sections";
import { LuxuryHeader } from "./luxury/Header";
import { LuxuryFooter } from "./luxury/Footer";
import { LuxuryHero } from "./luxury/Hero";
import { LuxuryCategoryNav } from "./luxury/CategoryNav";
import { LuxuryMenuSection } from "./luxury/MenuSection";
import { LuxuryFeatured, LuxuryAbout, LuxuryGallery, LuxuryCta } from "./luxury/Sections";
import { ContemporaryHeader } from "./contemporary/Header";
import { ContemporaryFooter } from "./contemporary/Footer";
import { ContemporaryHero } from "./contemporary/Hero";
import { ContemporaryCategoryNav } from "./contemporary/CategoryNav";
import { ContemporaryMenuSection } from "./contemporary/MenuSection";
import { ContemporaryFeatured, ContemporaryAbout, ContemporaryGallery, ContemporaryCta } from "./contemporary/Sections";
import { UrbanHeader } from "./urban/Header";
import { UrbanFooter } from "./urban/Footer";
import { UrbanHero } from "./urban/Hero";
import { UrbanCategoryNav } from "./urban/CategoryNav";
import { UrbanMenuSection } from "./urban/MenuSection";
import { UrbanFeatured, UrbanAbout, UrbanGallery, UrbanCta } from "./urban/Sections";
import { MinimalHeader } from "./minimal/Header";
import { MinimalFooter } from "./minimal/Footer";
import { MinimalHero } from "./minimal/Hero";
import { MinimalCategoryNav } from "./minimal/CategoryNav";
import { MinimalMenuSection } from "./minimal/MenuSection";
import { MinimalFeatured, MinimalAbout, MinimalGallery, MinimalCta } from "./minimal/Sections";

/**
 * Phase 31 — the theme definition registry: which themes exist, their default tokens, and which
 * component implements each part of the storefront. This is the ONE place a new theme is added;
 * MenuPage/Layout never branch on `themeKey` directly, they only ever consume `useActiveTheme()`'s
 * resolved `components`/`tokens` (see useActiveTheme.ts). Never persisted — see
 * docs/theme-architecture.md's three-layer split.
 *
 * Phase 33 — five new, genuinely distinct art-directed systems were added (Cinematic/Luxury/
 * Contemporary/Urban/Minimal), meant to be the primary showcase collection Theme Studio's picker
 * leads with. Classic/Modern/Editorial are DELIBERATELY kept, unchanged, rather than deleted: an
 * exploratory attempt to delete them and alias their `themeKey` to a "closest successor" new theme
 * was reverted after tracing the real blast radius — 18+ existing Playwright specs (and the demo-
 * restaurant/spice-route/bella-vista fixtures they share) assert on Classic's exact structural
 * fingerprint (button text, section presence, DOM shape), which none of the five new themes
 * reproduce (nor should they — that's the whole point of them being genuinely different). Keeping
 * all eight registry entries means an existing restaurant's persisted `themeKey` renders EXACTLY
 * what it always has — true zero-regression safety, not a hopeful alias mapping — while the five new
 * themes are what Theme Studio actually promotes going forward (see themeCatalog.ts in apps/admin,
 * which only lists the five current directions).
 */
export const THEME_REGISTRY: Record<string, ThemeDefinition> = {
  cinematic: {
    key: "cinematic",
    name: "Cinematic",
    description: "Immersive and dramatic — a viewport-height photographic hero, typography sitting directly on the image, a transparent nav that solidifies on scroll. A restaurant-film register, not an app.",
    styleTags: ["Immersive", "Dramatic", "Image-led"],
    motion: { intensity: "expressive" },
    // Phase 42 Stage 2B — recolored toward the marketing site's own warm ember/amber identity for
    // brand continuity (primary was already a close amber-gold match; accent moves from a cool
    // wine-red to a warmer burnt-ember so every accent moment reads as the same brand, not two).
    defaultTokens: {
      colors: {
        primary: "#c8933e",
        primaryForeground: "#1a1614",
        secondary: "#15130f",
        secondaryForeground: "#f7f3ec",
        accent: "#b8541f",
        accentForeground: "#f7f3ec",
        background: "#faf8f4",
        surface: "#ffffff",
        foreground: "#171512",
        muted: "#6b6459",
        border: "#e6e1d8",
      },
      radius: "sharp",
      density: "spacious",
      overlayOpacity: 0.5,
    },
    fonts: {
      heading: '"Didot", "Bodoni MT", "Big Caslon", Georgia, serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: CinematicHeader,
      Footer: CinematicFooter,
      Hero: CinematicHero,
      CategoryNav: CinematicCategoryNav,
      MenuSection: CinematicMenuSection,
      Featured: CinematicFeatured,
      About: CinematicAbout,
      Gallery: CinematicGallery,
      Cta: CinematicCta,
    },
  },
  luxury: {
    key: "luxury",
    name: "Luxury",
    description: "Elegant and editorial — sophisticated serif typography, thin hairline rules instead of cards, generous whitespace, understated text-only CTAs. Quality communicated through restraint, not decoration.",
    styleTags: ["Elegant", "Editorial", "Refined"],
    motion: { intensity: "subtle" },
    defaultTokens: {
      colors: {
        primary: "#6b2d3c",
        primaryForeground: "#faf7f2",
        secondary: "#2b2420",
        secondaryForeground: "#faf7f2",
        accent: "#a8823c",
        accentForeground: "#2b2420",
        background: "#faf7f2",
        surface: "#ffffff",
        foreground: "#221d19",
        muted: "#7d7266",
        border: "#e6ddd0",
      },
      radius: "sharp",
      density: "spacious",
    },
    fonts: {
      heading: 'Baskerville, "Big Caslon", "Hoefler Text", Garamond, Georgia, serif',
      body: '"Avenir Next", "Century Gothic", "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: LuxuryHeader,
      Footer: LuxuryFooter,
      Hero: LuxuryHero,
      CategoryNav: LuxuryCategoryNav,
      MenuSection: LuxuryMenuSection,
      Featured: LuxuryFeatured,
      About: LuxuryAbout,
      Gallery: LuxuryGallery,
      Cta: LuxuryCta,
    },
  },
  contemporary: {
    key: "contemporary",
    name: "Contemporary",
    description: "Experimental and bold — an asymmetric split-viewport hero, oversized display typography, off-grid alignment, floating price/index numbers. Designed by a digital art director, not a template.",
    styleTags: ["Experimental", "Bold", "Artistic"],
    motion: { intensity: "expressive" },
    defaultTokens: {
      colors: {
        primary: "#d7263d",
        primaryForeground: "#ffffff",
        secondary: "#0a0a0a",
        secondaryForeground: "#ffffff",
        accent: "#f2b705",
        accentForeground: "#0a0a0a",
        background: "#ffffff",
        surface: "#ffffff",
        foreground: "#0a0a0a",
        muted: "#6b6b6b",
        border: "#e5e5e5",
      },
      radius: "sharp",
      density: "compact",
    },
    fonts: {
      heading: '"Helvetica Neue", Arial, sans-serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: ContemporaryHeader,
      Footer: ContemporaryFooter,
      Hero: ContemporaryHero,
      CategoryNav: ContemporaryCategoryNav,
      MenuSection: ContemporaryMenuSection,
      Featured: ContemporaryFeatured,
      About: ContemporaryAbout,
      Gallery: ContemporaryGallery,
      Cta: ContemporaryCta,
    },
  },
  urban: {
    key: "urban",
    name: "Urban",
    description: "Energetic and graphic — bold condensed type, solid color blocks, dense numbered menu rows, a mobile-first sticky order bar. Built for premium street-food, pizza, burgers, and modern-casual brands.",
    styleTags: ["Energetic", "Graphic", "Modern"],
    motion: { intensity: "expressive" },
    defaultTokens: {
      colors: {
        primary: "#ff4d00",
        primaryForeground: "#141414",
        secondary: "#141414",
        secondaryForeground: "#ffffff",
        accent: "#ffd23f",
        accentForeground: "#141414",
        background: "#fafaf9",
        surface: "#ffffff",
        foreground: "#141414",
        muted: "#6b6b6b",
        border: "#141414",
      },
      radius: "sharp",
      density: "compact",
    },
    fonts: {
      heading: '"Arial Narrow", Impact, "Helvetica Neue", Arial, sans-serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
    },
    components: {
      Header: UrbanHeader,
      Footer: UrbanFooter,
      Hero: UrbanHero,
      CategoryNav: UrbanCategoryNav,
      MenuSection: UrbanMenuSection,
      Featured: UrbanFeatured,
      About: UrbanAbout,
      Gallery: UrbanGallery,
      Cta: UrbanCta,
    },
  },
  minimal: {
    key: "minimal",
    name: "Minimal",
    description: "Calm and precise — enormous whitespace, a text-first dotted-leader menu, near-silent motion, no shadows, no cards. The absence of visual noise is the design.",
    styleTags: ["Calm", "Refined", "Precise"],
    motion: { intensity: "subtle" },
    defaultTokens: {
      colors: {
        primary: "#5b5347",
        primaryForeground: "#ffffff",
        secondary: "#1c1a17",
        secondaryForeground: "#ffffff",
        accent: "#8a7a5c",
        accentForeground: "#ffffff",
        background: "#ffffff",
        surface: "#ffffff",
        foreground: "#1c1a17",
        muted: "#8c8377",
        border: "#e8e4dd",
      },
      radius: "sharp",
      density: "spacious",
    },
    fonts: {
      heading: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", system-ui, sans-serif',
      body: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", system-ui, sans-serif',
    },
    components: {
      Header: MinimalHeader,
      Footer: MinimalFooter,
      Hero: MinimalHero,
      CategoryNav: MinimalCategoryNav,
      MenuSection: MinimalMenuSection,
      Featured: MinimalFeatured,
      About: MinimalAbout,
      Gallery: MinimalGallery,
      Cta: MinimalCta,
    },
  },
  classic: {
    key: "classic",
    name: "Classic",
    description: "Warm and familiar — a rounded banner, pill navigation, and a friendly card grid. The traditional restaurant-website register.",
    styleTags: ["Traditional", "Friendly", "Familiar"],
    motion: { intensity: "standard" },
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
    styleTags: ["Bold", "High-contrast", "Confident"],
    motion: { intensity: "standard" },
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
    styleTags: ["Quiet", "Refined", "Spacious"],
    motion: { intensity: "subtle" },
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
