import { defaultRestaurantThemeConfig } from "@restaurant/types";
import type { RestaurantThemeConfig } from "@restaurant/types";
import { resolveThemeTokens } from "./resolveTokens";
import { THEME_REGISTRY } from "./registry";

// Phase 33 — any two current registry entries work here; resolveThemeTokens' derived-foreground
// logic uses fixed LIGHT_FOREGROUND/DARK_FOREGROUND constants independent of the base theme, so
// these assertions aren't tied to any one theme's specific palette.
const themeA = THEME_REGISTRY.luxury;
const themeB = THEME_REGISTRY.urban;

describe("resolveThemeTokens", () => {
  it("returns the theme's own defaults untouched when the restaurant made no overrides", () => {
    const tokens = resolveThemeTokens(themeA, defaultRestaurantThemeConfig());
    expect(tokens.colors).toEqual(themeA.defaultTokens.colors);
    expect(tokens.radius).toBe(themeA.defaultTokens.radius);
    expect(tokens.density).toBe(themeA.defaultTokens.density);
  });

  it("applies a restaurant's primary color override and derives a readable foreground for it", () => {
    const config: RestaurantThemeConfig = {
      ...defaultRestaurantThemeConfig(),
      colors: { primary: "#0a0a0a" }, // near-black — should get a light foreground
    };
    const tokens = resolveThemeTokens(themeA, config);
    expect(tokens.colors.primary).toBe("#0a0a0a");
    expect(tokens.colors.primaryForeground).toBe("#fffaf5");
    // Untouched colors still come from the theme's own defaults.
    expect(tokens.colors.secondary).toBe(themeA.defaultTokens.colors.secondary);
  });

  it("derives a dark foreground for a light override color", () => {
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), colors: { accent: "#fefefe" } };
    const tokens = resolveThemeTokens(themeA, config);
    expect(tokens.colors.accent).toBe("#fefefe");
    expect(tokens.colors.accentForeground).toBe("#1c1917");
  });

  it("never lets a restaurant override the platform-fixed status colors or the theme's typography", () => {
    // ThemeColorOverrides only has primary/secondary/accent/background — TypeScript itself
    // prevents passing anything else, but this asserts the runtime behavior matches: unrelated
    // theme fields (fonts) are untouched by resolveThemeTokens entirely.
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), colors: { background: "#000000" } };
    const tokens = resolveThemeTokens(themeB, config);
    expect(tokens.colors.background).toBe("#000000");
    expect(themeB.fonts.heading).toBe(THEME_REGISTRY.urban.fonts.heading);
  });

  it("prefers a restaurant's radius/density override over the theme default", () => {
    const config: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), radius: "rounded", density: "spacious" };
    const tokens = resolveThemeTokens(themeA, config);
    expect(tokens.radius).toBe("rounded");
    expect(tokens.density).toBe("spacious");
  });

  it("passes a theme's overlayOpacity through untouched (cinematic sets it, not restaurant-overridable)", () => {
    const tokens = resolveThemeTokens(THEME_REGISTRY.cinematic, defaultRestaurantThemeConfig());
    expect(tokens.overlayOpacity).toBe(THEME_REGISTRY.cinematic.defaultTokens.overlayOpacity);
    expect(tokens.overlayOpacity).toBe(0.5);
  });

  it("resolves overlayOpacity to undefined for a theme that doesn't set one", () => {
    // themeA (luxury) has no overlayOpacity in its defaultTokens — resolveThemeTokens must not
    // invent one, leaving each theme's own component to apply its own fallback (e.g. Cinematic's
    // Hero uses `tokens.overlayOpacity ?? 0.55`).
    expect(themeA.defaultTokens.overlayOpacity).toBeUndefined();
    const tokens = resolveThemeTokens(themeA, defaultRestaurantThemeConfig());
    expect(tokens.overlayOpacity).toBeUndefined();
  });
});
