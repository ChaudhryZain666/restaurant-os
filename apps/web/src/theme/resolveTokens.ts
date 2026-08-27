import { isDarkColor } from "@restaurant/ui";
import type { RestaurantThemeConfig, ThemeTokens } from "@restaurant/types";
import type { ThemeDefinition } from "./types";

const LIGHT_FOREGROUND = "#fffaf5";
const DARK_FOREGROUND = "#1c1917";

function foregroundFor(hex: string): string {
  return isDarkColor(hex) ? LIGHT_FOREGROUND : DARK_FOREGROUND;
}

/**
 * Merges a theme definition's default tokens with a restaurant's own color/radius/density
 * overrides (RestaurantThemeConfig — small, structured, hex-validated server-side). A restaurant
 * can only ever override `primary`/`secondary`/`accent`/`background` — never their `-foreground`
 * counterparts (see @restaurant/types' ThemeColorOverrides) or status colors (success/warning/
 * danger stay fixed platform-wide), so a matching readable foreground is derived automatically via
 * WCAG relative luminance whenever a color is overridden.
 */
export function resolveThemeTokens(definition: ThemeDefinition, config: RestaurantThemeConfig): ThemeTokens {
  const base = definition.defaultTokens;
  const overrides = config.colors;

  return {
    colors: {
      ...base.colors,
      ...(overrides.primary ? { primary: overrides.primary, primaryForeground: foregroundFor(overrides.primary) } : {}),
      ...(overrides.secondary
        ? { secondary: overrides.secondary, secondaryForeground: foregroundFor(overrides.secondary) }
        : {}),
      ...(overrides.accent ? { accent: overrides.accent, accentForeground: foregroundFor(overrides.accent) } : {}),
      ...(overrides.background ? { background: overrides.background } : {}),
    },
    radius: config.radius ?? base.radius,
    density: config.density ?? base.density,
  };
}
