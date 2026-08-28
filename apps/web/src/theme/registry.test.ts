import { THEME_KEYS } from "@restaurant/types";
import { DEFAULT_THEME_KEY, getThemeDefinition, THEME_REGISTRY } from "./registry";
import { HEX_COLOR_PATTERN } from "@restaurant/ui";

const COMPONENT_KEYS = ["Header", "Footer", "Hero", "CategoryNav", "MenuSection", "Featured", "About", "Gallery", "Cta"] as const;

describe("THEME_REGISTRY", () => {
  it("defines exactly the themes declared in the shared @restaurant/types contract — never more, never fewer", () => {
    // Phase 33 — all eight keys are real, distinct registry entries: the original three
    // (Classic/Modern/Editorial) were deliberately KEPT rather than deleted-and-aliased, after
    // tracing that 18+ existing Playwright specs assert on their exact structural fingerprint (see
    // registry.tsx's own doc comment for the full reasoning). The five new themes
    // (Cinematic/Luxury/Contemporary/Urban/Minimal) are what Theme Studio's picker actually
    // promotes going forward — see apps/admin's themeCatalog.ts.
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

  it("gives every theme its own styleTags (Theme Studio/demo-playground picker metadata)", () => {
    for (const def of Object.values(THEME_REGISTRY)) {
      expect(def.styleTags.length).toBeGreaterThan(0);
    }
  });

  it("gives every theme a motion intensity — not every theme silently sharing one timing feel", () => {
    const intensities = new Set(Object.values(THEME_REGISTRY).map((t) => t.motion.intensity));
    expect(intensities.size).toBeGreaterThan(1);
  });

  // Phase 33 — the five current directions Theme Studio actually promotes (see apps/admin's
  // themeCatalog.ts) each need a real, distinct entry here; this is the one assertion that would
  // have caught the accidental duplicate Contemporary/Urban heading-font bug found during review.
  it("gives each of the five current Phase-33 directions its own registry entry with a unique heading font", () => {
    const currentKeys = ["cinematic", "luxury", "contemporary", "urban", "minimal"];
    const fonts = currentKeys.map((k) => THEME_REGISTRY[k]?.fonts.heading);
    expect(fonts.every(Boolean)).toBe(true);
    expect(new Set(fonts).size).toBe(currentKeys.length);
  });
});

describe("getThemeDefinition", () => {
  it("resolves a known theme key to its own definition", () => {
    expect(getThemeDefinition("modern").key).toBe("modern");
    expect(getThemeDefinition("urban").key).toBe("urban");
  });

  it("falls back to the default theme for an unknown/corrupted key rather than throwing", () => {
    expect(getThemeDefinition("not-a-real-theme").key).toBe(DEFAULT_THEME_KEY);
  });

  it("defaults to classic — the theme every pre-Phase-31 restaurant is treated as having, still rendered exactly as it always was", () => {
    expect(DEFAULT_THEME_KEY).toBe("classic");
    expect(THEME_REGISTRY.classic).toBeDefined();
  });
});
