/**
 * The design-token contract for storefront theming.
 *
 * The actual VALUES for the default theme live in one place: `apps/web/src/index.css`'s
 * `:root` block, as CSS custom properties (`--color-primary`, `--radius-md`, ...). Tailwind's
 * config maps utility classes to those same variables (`bg-primary` -> `var(--color-primary)`),
 * so every component that uses a Tailwind color/radius/shadow class is already theme-aware with
 * zero extra work — overriding a CSS variable at runtime (see ThemeProvider in apps/web)
 * repaints everything that uses it, without a rebuild.
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
