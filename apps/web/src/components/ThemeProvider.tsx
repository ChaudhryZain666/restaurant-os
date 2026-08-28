import { useMemo, type CSSProperties, type ReactNode } from "react";
import { tokensToCssVars } from "@restaurant/ui";
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

  const style: CSSProperties = {
    display: "contents",
    ...tokensToCssVars(active.tokens),
    ["--font-heading" as string]: active.definition.fonts.heading,
    ["--font-body" as string]: active.definition.fonts.body,
  };

  return (
    <ActiveThemeContext.Provider value={active}>
      <div style={style}>{children}</div>
    </ActiveThemeContext.Provider>
  );
}
