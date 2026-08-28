/**
 * Phase 31 — the theme engine's data contract. Deliberately split into three layers that never
 * collapse into one blob (see docs/theme-architecture.md):
 *
 *  1. THEME DEFINITION (developer-controlled, code — apps/web/src/theme/registry.tsx) — which
 *     themes exist, their default tokens, and which sections/layouts they actually know how to
 *     render. Never persisted to the database.
 *  2. RESTAURANT THEME CONFIG (this file's RestaurantThemeConfig — database-persisted, per
 *     restaurant) — which theme a restaurant chose and what it overrode on top of that theme's
 *     defaults. Small and structured; never a free-form style blob.
 *  3. STOREFRONT RUNTIME (apps/web) — merges 1 + 2 and renders. Never touches ordering logic.
 */

/** Phase 33 — the first three are legacy keys, kept permanently valid (never removed) so a restaurant
 *  that persisted one before this phase never fails validation on an unrelated save; the storefront
 *  registry (apps/web/src/theme/registry.tsx) resolves them to one of the five current themes via
 *  LEGACY_THEME_KEY_ALIASES for rendering. Theme Studio only ever writes one of the five current
 *  keys going forward. */
export const THEME_KEYS = [
  "classic",
  "modern",
  "editorial",
  "cinematic",
  "luxury",
  "contemporary",
  "urban",
  "minimal",
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

/** Every color a theme or restaurant override can set. Hex-only (#rrggbb), validated server-side
 *  — never a raw CSS value, so this can never smuggle in arbitrary CSS. */
export interface ThemeColorTokens {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  border: string;
}

export const THEME_RADIUS_SCALES = ["sharp", "soft", "rounded"] as const;
export type ThemeRadiusScale = (typeof THEME_RADIUS_SCALES)[number];

export const THEME_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type ThemeDensity = (typeof THEME_DENSITIES)[number];

/** Full resolved token set a theme definition provides defaults for, and a restaurant can
 *  partially override. Deliberately excludes any translatable copy (button labels, headings) —
 *  those stay in the application's own i18n-ready string layer (see docs/theme-architecture.md's
 *  "Future multilingual compatibility" section), not here. */
export interface ThemeTokens {
  colors: ThemeColorTokens;
  radius: ThemeRadiusScale;
  density: ThemeDensity;
  /** Phase 33 — how strong a dark overlay a theme lays over full-bleed photography (0-1), e.g. for
   *  legible hero typography sitting directly on an image. Not restaurant-overridable — it's part of
   *  a theme's own visual identity, the same category as its font stacks. Themes that don't compose
   *  imagery this way simply never read it. */
  overlayOpacity?: number;
}

/** A restaurant's own color choices — every field optional (unset = inherit the theme's default
 *  for that token). Only the handful of colors an owner should reasonably control; --color-success/
 *  warning/danger stay fixed platform-wide (status colors must stay legible/consistent regardless
 *  of branding, e.g. a red error must never become a brand-colored "error"). */
export interface ThemeColorOverrides {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
}

export const THEME_SECTION_KEYS = ["hero", "featured", "about", "gallery", "cta"] as const;
export type ThemeSectionKey = (typeof THEME_SECTION_KEYS)[number];

/** Whether each optional storefront section is shown — only ever toggles sections the ACTIVE
 *  theme's definition actually declares support for (see ThemeDefinition.supportedSections); the
 *  admin Theme Studio only ever offers toggles the current theme can really render. */
export type ThemeSectionVisibility = Partial<Record<ThemeSectionKey, boolean>>;

/** A restaurant's persisted theme choice — small and fully structured, never an arbitrary object.
 *  This is the shape both `settings.theme` (published) and `settings.themeDraft` (unpublished
 *  edits) share on the Restaurant document. */
export interface RestaurantThemeConfig {
  themeKey: ThemeKey;
  /** The theme definition's own version this config was last saved against — see
   *  docs/theme-architecture.md's "Versioning" section for the compatibility strategy. */
  themeVersion: number;
  colors: ThemeColorOverrides;
  radius?: ThemeRadiusScale;
  density?: ThemeDensity;
  sections: ThemeSectionVisibility;
}

export function defaultRestaurantThemeConfig(): RestaurantThemeConfig {
  return { themeKey: "classic", themeVersion: 1, colors: {}, sections: {} };
}

/**
 * Guarantees `colors`/`sections` are always present plain objects, never undefined — a value
 * fresh out of Mongoose can come back missing them (a nested-subdocument-default limitation: an
 * "all fields still default" colors/sections subdocument doesn't reliably persist/serialize its
 * own empty-object shape — see apps/api/src/controllers/theme.controller.ts's own note on this).
 * Called at every read boundary (API responses, the Theme Studio's own state) rather than fought
 * at the Mongoose layer, so every consumer can rely on `config.colors`/`config.sections` always
 * being safely spreadable/destructurable without an undefined check.
 */
export function normalizeThemeConfig(config: Partial<RestaurantThemeConfig> | null | undefined): RestaurantThemeConfig {
  return {
    themeKey: config?.themeKey ?? "classic",
    themeVersion: config?.themeVersion ?? 1,
    colors: config?.colors ?? {},
    sections: config?.sections ?? {},
    ...(config?.radius ? { radius: config.radius } : {}),
    ...(config?.density ? { density: config.density } : {}),
  };
}
