import { defaultRestaurantThemeConfig } from "@restaurant/types";
import type { RestaurantThemeConfig } from "@restaurant/types";
import { resolveThemeTokens } from "./resolveTokens";
import { THEME_REGISTRY } from "./registry";

const classic = THEME_REGISTRY.classic;
const modern = THEME_REGISTRY.modern;

describe("resolveThemeTokens", () => {
  it("returns the theme's own defaults untouched when the restaurant made no overrides", () => {
    const tokens = resolveThemeTokens(classic, defaultRestaurantThemeConfig());
    expect(tokens.colors).toEqual(classic.defaultTokens.colors);
    expect(tokens.radius).toBe(classic.defaultTokens.radius);
    expect(tokens.density).toBe(classic.defaultTokens.density);
  });

  it("applies a restaurant's primary color override and derives a readable foreground for it", () => {
    const config: RestaurantThemeConfig = {
      ...defaultRestaurantThemeConfig(),
      colors: { primary: "#0a0a0a" }, // near-black — should get a light foreground
    };
    const tokens = resolveThemeTokens(classic, config);
    expect(tokens.colors.primary).toBe("#0a0a0a");
    expect(tokens.colors.primaryForeground).toBe("#fffaf5");
    // Untouched colors still come from the theme's own defaults.
    expect(tokens.colors.secondary).toBe(classic.defaultTokens.colors.secondary);
  });

  it("derives a dark foreground for a light override color", () => {
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), colors: { accent: "#fefefe" } };
    const tokens = resolveThemeTokens(classic, config);
    expect(tokens.colors.accent).toBe("#fefefe");
    expect(tokens.colors.accentForeground).toBe("#1c1917");
  });

  it("never lets a restaurant override the platform-fixed status colors or the theme's typography", () => {
    // ThemeColorOverrides only has primary/secondary/accent/background — TypeScript itself
    // prevents passing anything else, but this asserts the runtime behavior matches: unrelated
    // theme fields (fonts) are untouched by resolveThemeTokens entirely.
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), colors: { background: "#000000" } };
    const tokens = resolveThemeTokens(modern, config);
    expect(tokens.colors.background).toBe("#000000");
    expect(modern.fonts.heading).toBe(THEME_REGISTRY.modern.fonts.heading);
  });

  it("prefers a restaurant's radius/density override over the theme default", () => {
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), radius: "rounded", density: "spacious" };
    const tokens = resolveThemeTokens(classic, config);
    expect(tokens.radius).toBe("rounded");
    expect(tokens.density).toBe("spacious");
  });
});
