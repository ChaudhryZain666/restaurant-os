import { defaultRestaurantThemeConfig, type RestaurantThemeConfig } from "@restaurant/types";

/**
 * Phase 32 — pure decision logic behind ThemeProvider's config resolution, extracted (same reason
 * resolveThemeTokens.ts is its own file) so the slug-matching guard can be unit tested without
 * rendering React: a client-only playground `override` wins over the restaurant's real published
 * theme, but ONLY when it was captured for the restaurant CURRENTLY being rendered — otherwise a
 * same-tab client-side navigation to an unrelated restaurant would inherit a stale override, since
 * React context state persists across route changes without a full reload.
 */
export function resolveActiveThemeConfig(
  restaurantSlug: string | undefined,
  restaurantTheme: RestaurantThemeConfig | undefined,
  override: { slug: string; config: RestaurantThemeConfig } | null
): RestaurantThemeConfig {
  if (override && override.slug === restaurantSlug) return override.config;
  return restaurantTheme ?? defaultRestaurantThemeConfig();
}
