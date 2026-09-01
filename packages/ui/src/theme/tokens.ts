import type { CSSProperties } from "react";
import type { ThemeDensity, ThemeRadiusScale, ThemeTokens } from "@restaurant/types";

/**
 * The design-token contract for storefront theming.
 *
 * The actual VALUES for the default theme live in one place: `apps/web/src/index.css`'s
 * `:root` block, as CSS custom properties (`--color-primary`, `--radius-md`, ...). Tailwind's
 * config maps utility classes to those same variables (`bg-primary` -> `var(--color-primary)`),
 * so every component that uses a Tailwind color/radius/shadow class is already theme-aware with
 * zero extra work — overriding a CSS variable at runtime repaints everything that uses it,
 * without a rebuild.
 *
 * This file exists so the token *shape* is typed and documented in one importable place (used
 * by the motion hooks below, and as the reference for what the CSS variables must define) —
 * it is deliberately NOT the runtime source of truth for color values, since Tailwind's static
 * config can't consume a TS module at build time without extra tooling this project doesn't
 * otherwise need.
 */
export interface ColorTokens {
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  surface: string;
  surfaceElevated: string;
  foreground: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
}

export interface TypographyTokens {
  fontFamily: string;
  headingFontFamily: string;
  bodyFontFamily: string;
}

export interface SpacingTokens {
  xs: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  "2xl": string;
  "3xl": string;
}

export interface RadiusTokens {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  pill: string;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
  elevated: string;
}

export interface MotionTokens {
  durationFast: number;
  durationNormal: number;
  durationSlow: number;
  easing: string;
}

export interface DesignTokens {
  colors: ColorTokens;
  typography: TypographyTokens;
  spacing: SpacingTokens;
  radius: RadiusTokens;
  shadows: ShadowTokens;
  motion: MotionTokens;
}

/**
 * Motion values in JS form (milliseconds/easing string), for code that needs actual numbers —
 * e.g. matching a CSS transition duration in a `setTimeout`, or an IntersectionObserver-driven
 * stagger delay. Kept in sync with the `--motion-*` CSS variables by convention (both are small,
 * stable, and rarely change together).
 */
export const motionTokens: MotionTokens = {
  durationFast: 120,
  durationNormal: 220,
  durationSlow: 420,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

/**
 * Phase 31 — the runtime bridge from a restaurant's resolved ThemeTokens (packages/types/src/types/
 * theme.ts — a theme definition's defaults merged with the restaurant's own overrides) into the
 * exact CSS custom properties above. This is the ONLY function that ever needs to know the CSS
 * variable names, so every theme/restaurant-override consumer stays purely data-driven — no
 * component ever hardcodes a `#hex` or a `12px`.
 */
const RADIUS_SCALE_VALUES: Record<ThemeRadiusScale, { sm: string; md: string; lg: string; xl: string }> = {
  sharp: { sm: "0.125rem", md: "0.25rem", lg: "0.375rem", xl: "0.5rem" },
  soft: { sm: "0.375rem", md: "0.625rem", lg: "1rem", xl: "1.5rem" },
  rounded: { sm: "0.625rem", md: "1rem", lg: "1.5rem", xl: "2rem" },
};

const DENSITY_SPACING_VALUES: Record<ThemeDensity, string> = {
  compact: "1rem",
  comfortable: "1.5rem",
  spacious: "2.25rem",
};

/** "#rrggbb" -> "r g b" (space-separated decimal) — the form tailwind.config.js's
 *  `rgb(var(--color-x-rgb) / <alpha-value>)` pattern requires so opacity modifiers
 *  (bg-primary/10, text-foreground/70, ...) work on a runtime-overridden color. See this file's
 *  own note on index.css's matching static `-rgb` variables. */
export function hexToRgbTriplet(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r} ${g} ${b}`;
}

export function tokensToCssVars(tokens: ThemeTokens): CSSProperties {
  const radius = RADIUS_SCALE_VALUES[tokens.radius];
  const c = tokens.colors;
  const vars: Record<string, string> = {};
  for (const [key, hex] of Object.entries(c) as [keyof typeof c, string][]) {
    // primaryForeground -> --color-primary-foreground(-rgb)
    const cssName = key.replace(/([A-Z])/g, "-$1").toLowerCase();
    vars[`--color-${cssName}`] = hex;
    vars[`--color-${cssName}-rgb`] = hexToRgbTriplet(hex);
  }
  vars["--radius-sm"] = radius.sm;
  vars["--radius-md"] = radius.md;
  vars["--radius-lg"] = radius.lg;
  vars["--radius-xl"] = radius.xl;
  vars["--spacing-section"] = DENSITY_SPACING_VALUES[tokens.density];
  return vars as CSSProperties;
}

/** WCAG relative luminance — used only to auto-pick a readable foreground against a color a
 *  restaurant chose, never for any business decision. */
export function isDarkColor(hex: string): boolean {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16) / 255);
  const [rl, gl, bl] = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl < 0.5;
}

export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
