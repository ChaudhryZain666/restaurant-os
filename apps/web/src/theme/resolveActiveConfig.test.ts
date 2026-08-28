import { defaultRestaurantThemeConfig } from "@restaurant/types";
import type { RestaurantThemeConfig } from "@restaurant/types";
import { resolveActiveThemeConfig } from "./resolveActiveConfig";

const published: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), themeKey: "modern" };
const overrideConfig: RestaurantThemeConfig = { ...defaultRestaurantThemeConfig(), themeKey: "editorial" };

describe("resolveActiveThemeConfig", () => {
  it("applies the override when it was captured for the currently-rendered restaurant", () => {
    const config = resolveActiveThemeConfig("demo-restaurant", published, { slug: "demo-restaurant", config: overrideConfig });
    expect(config).toBe(overrideConfig);
  });

  it("falls through to the restaurant's real published theme when the override is for a DIFFERENT restaurant — the load-bearing guard against a same-tab navigation leaking one restaurant's override onto another", () => {
    const config = resolveActiveThemeConfig("some-other-restaurant", published, { slug: "demo-restaurant", config: overrideConfig });
    expect(config).toBe(published);
  });

  it("falls through to the restaurant's real published theme when there is no override at all", () => {
    const config = resolveActiveThemeConfig("demo-restaurant", published, null);
    expect(config).toBe(published);
  });

  it("falls through to the platform default when there is neither a restaurant theme nor an override", () => {
    const config = resolveActiveThemeConfig(undefined, undefined, null);
    expect(config).toEqual(defaultRestaurantThemeConfig());
  });
});
