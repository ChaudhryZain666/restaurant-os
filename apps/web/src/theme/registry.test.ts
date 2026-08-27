import { THEME_KEYS } from "@restaurant/types";
import { DEFAULT_THEME_KEY, getThemeDefinition, THEME_REGISTRY } from "./registry";
import { HEX_COLOR_PATTERN } from "@restaurant/ui";

const COMPONENT_KEYS = ["Header", "Footer", "Hero", "CategoryNav", "MenuSection", "Featured", "About", "Gallery", "Cta"] as const;

describe("THEME_REGISTRY", () => {
  it("defines exactly the themes declared in the shared @restaurant/types contract — never more, never fewer", () => {
    expect(Object.keys(THEME_REGISTRY).sort()).toEqual([...THEME_KEYS].sort());
  });

  it("gives every theme every hex color the backend's ThemeColorTokens contract requires", () => {
    for (const [key, def] of Object.entries(THEME_REGISTRY)) {
      expect(def.key).toBe(key);
      const c = def.defaultTokens.colors;
      for (const value of Object.values(c)) {
        expect(HEX_COLOR_PATTERN.test(value)).toBe(true);
      }
    }
  });

  it("gives every theme a full component set — a theme can never fall back to another theme's JSX", () => {
    for (const def of Object.values(THEME_REGISTRY)) {
      for (const key of COMPONENT_KEYS) {
        expect(def.components[key]).toBeDefined();
      }
    }
  });

  it("gives every theme its own distinct component implementations (no accidental sharing between themes)", () => {
    const themes = Object.values(THEME_REGISTRY);
    for (const key of COMPONENT_KEYS) {
      const implementations = new Set(themes.map((t) => t.components[key]));
      expect(implementations.size).toBe(themes.length);
    }
  });

  it("gives every theme its own font stacks, never falling back to a shared/system-wide default silently", () => {
    const headingFonts = new Set(Object.values(THEME_REGISTRY).map((t) => t.fonts.heading));
    expect(headingFonts.size).toBe(Object.keys(THEME_REGISTRY).length);
  });
});

describe("getThemeDefinition", () => {
  it("resolves a known theme key to its own definition", () => {
    expect(getThemeDefinition("modern").key).toBe("modern");
  });

  it("falls back to the default theme for an unknown/corrupted key rather than throwing", () => {
    expect(getThemeDefinition("not-a-real-theme").key).toBe(DEFAULT_THEME_KEY);
  });

  it("defaults to classic — the theme every pre-Phase-31 restaurant is treated as having", () => {
    expect(DEFAULT_THEME_KEY).toBe("classic");
  });
});
