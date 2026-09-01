import { useMemo, type CSSProperties, type ReactNode } from "react";
import { tokensToCssVars, isDarkColor, HEX_COLOR_PATTERN, hexToRgbTriplet } from "@restaurant/ui";
import { useRestaurant } from "../context/RestaurantContext";
import { getThemeDefinition } from "../theme/registry";
import { resolveThemeTokens } from "../theme/resolveTokens";
import { resolveActiveThemeConfig } from "../theme/resolveActiveConfig";
import { ActiveThemeContext, type ActiveTheme } from "../theme/useActiveTheme";
import { useThemeOverride } from "../theme/ThemeOverrideContext";

/**
 * Phase 31 — resolves the active ThemeDefinition (registry.tsx — code, never persisted) against
 * the restaurant's own RestaurantThemeConfig (settings.theme — small, structured, DB-persisted),
 * applies the merged token set as CSS custom properties, and provides both the resolved tokens and
 * the theme's component set via context so Layout/MenuPage can render the right Header/Hero/
 * CategoryNav/MenuSection/Footer without ever branching on `themeKey` themselves.
 *
 * Before Phase 31 this component only ever set two variables from `settings.brandColor`. It now
 * sets the FULL token set (colors/radius/density) plus each theme's own font stacks — every other
 * behavior (display:contents so it never affects layout, a safe fallback while the restaurant is
 * still loading) is preserved from that original implementation.
 *
 * Phase 41 — restored `settings.brandColor` as a real override on top of the resolved theme tokens.
 * The Phase 31 rewrite silently dropped it: admin Settings still offered the "Brand color" control
 * and told owners it "applies regardless of theme," but nothing in this file read it anymore, so the
 * control saved a value nothing ever rendered. Re-applied here exactly as the pre-theme-engine
 * implementation did it — override `--color-primary` (and its `-rgb` twin, needed by the
 * `bg-primary/10`-style opacity utilities) plus a WCAG-luminance-derived foreground — layered AFTER
 * the theme's own token resolution so it's a real "quick override," not a second competing theme
 * system.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useRestaurant();
  const { override } = useThemeOverride();

  const active: ActiveTheme = useMemo(() => {
    const config = resolveActiveThemeConfig(restaurant?.slug, restaurant?.settings.theme, override);
    const definition = getThemeDefinition(config.themeKey);
    const tokens = resolveThemeTokens(definition, config);
    return { definition, tokens, sections: config.sections };
  }, [restaurant, override]);

  const brandColor = restaurant?.settings.brandColor;
  const brandColorVars: CSSProperties =
    brandColor && HEX_COLOR_PATTERN.test(brandColor)
      ? {
          ["--color-primary" as string]: brandColor,
          ["--color-primary-rgb" as string]: hexToRgbTriplet(brandColor),
          ["--color-primary-foreground" as string]: isDarkColor(brandColor) ? "#fffaf5" : "#1c1917",
        }
      : {};

  const style: CSSProperties = {
    display: "contents",
    ...tokensToCssVars(active.tokens),
    ["--font-heading" as string]: active.definition.fonts.heading,
    ["--font-body" as string]: active.definition.fonts.body,
    ...brandColorVars,
  };

  return (
    <ActiveThemeContext.Provider value={active}>
      <div style={style}>{children}</div>
    </ActiveThemeContext.Provider>
  );
}
