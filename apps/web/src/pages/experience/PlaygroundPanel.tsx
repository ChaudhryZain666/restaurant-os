import { useEffect, useState } from "react";
import type { RestaurantThemeConfig, ThemeSectionKey } from "@restaurant/types";
import { normalizeThemeConfig } from "@restaurant/types";
import { Badge, Button, HEX_COLOR_PATTERN } from "@restaurant/ui";
import { useRestaurant } from "../../context/RestaurantContext";
import { useThemeOverride } from "../../theme/ThemeOverrideContext";
import { THEME_REGISTRY } from "../../theme/registry";
import { MenuPage } from "../MenuPage";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

// Phase 33 — the playground (this is the sales-facing "wow" surface) shows only the five current,
// premium-art-directed themes, matching Theme Studio's own picker (apps/admin's themeCatalog.ts).
// THEME_REGISTRY also keeps classic/modern/editorial (see registry.tsx's doc comment on why they
// were deliberately never deleted), but showing them here would dilute the showcase this route
// exists for — they're legacy-safety entries, not part of the collection being sold.
const PLAYGROUND_THEME_KEYS = ["cinematic", "luxury", "contemporary", "urban", "minimal"];

const COLOR_FIELDS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
] as const;

const OPTIONAL_SECTIONS: { key: Exclude<ThemeSectionKey, "hero">; label: string }[] = [
  { key: "featured", label: "Popular picks" },
  { key: "about", label: "Our story" },
  { key: "gallery", label: "Gallery" },
  { key: "cta", label: "Closing call-to-action" },
];

const DEVICES = [
  { key: "desktop", label: "Desktop", maxWidth: "100%" },
  { key: "tablet", label: "Tablet", maxWidth: "768px" },
  { key: "mobile", label: "Mobile", maxWidth: "390px" },
] as const;

function isValidHex(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Phase 32 — the split-screen playground: real theme/color/section controls on the left, driving a
 * client-only ThemeOverrideContext (never the real settings.theme/themeDraft), and the literal
 * unmodified <MenuPage/> on the right inside a device-width frame. Nothing here is a second
 * renderer — this IS the real production storefront, just handed a client-side-only config.
 */
export function PlaygroundPanel() {
  const { restaurant } = useRestaurant();
  const { override, setOverride, updateOverride } = useThemeOverride();
  const [device, setDevice] = useState<(typeof DEVICES)[number]["key"]>("desktop");

  const activeConfig: RestaurantThemeConfig = normalizeThemeConfig(
    override && override.slug === restaurant?.slug ? override.config : restaurant?.settings.theme
  );

  // Seed the override from the restaurant's real published theme the first time this panel sees
  // it, so editing starts from "what a real visitor already sees," not blank theme defaults —
  // this alone changes nothing visually (it's a client-only copy of the same values). If the
  // restaurant's real theme is one of the legacy keys (still valid, still rendered — see
  // registry.tsx — but not part of this showcase's five cards), seed from Cinematic instead so the
  // playground opens with a real card highlighted rather than none; this is purely the playground's
  // own starting point and never writes anything back to the restaurant's real settings.theme.
  useEffect(() => {
    if (!restaurant) return;
    if (override?.slug === restaurant.slug) return;
    const seed = PLAYGROUND_THEME_KEYS.includes(restaurant.settings.theme.themeKey)
      ? restaurant.settings.theme
      : { ...restaurant.settings.theme, themeKey: "cinematic" as const };
    setOverride(restaurant.slug, seed);
  }, [restaurant, override, setOverride]);

  if (!restaurant) return null;

  function updateColor(key: (typeof COLOR_FIELDS)[number]["key"], value: string) {
    if (!restaurant) return;
    updateOverride(restaurant.slug, { colors: { ...activeConfig.colors, [key]: value || undefined } });
  }
  function updateSection(key: ThemeSectionKey, shown: boolean) {
    if (!restaurant) return;
    updateOverride(restaurant.slug, { sections: { ...activeConfig.sections, [key]: shown } });
  }
  function selectTheme(key: string) {
    if (!restaurant) return;
    updateOverride(restaurant.slug, { themeKey: key as RestaurantThemeConfig["themeKey"] });
  }
  // Phase 41 — real fix for "Reset to original" being immediately clobbered back to Cinematic.
  // The old implementation called clearOverride(), which sets override to null; the seeding effect
  // above then re-fires on the very next render (its guard is `override?.slug === restaurant.slug`,
  // which null fails) and re-seeds Cinematic again — so the button visually did nothing. Setting the
  // override EXPLICITLY to the restaurant's real persisted theme, instead of clearing it, satisfies
  // that same guard and genuinely shows the restaurant's actual theme (Classic, for demo-restaurant).
  function resetToOriginal() {
    if (!restaurant) return;
    setOverride(restaurant.slug, restaurant.settings.theme);
  }

  const activeDevice = DEVICES.find((d) => d.key === device)!;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr] lg:items-start">
      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Theme</legend>
          <div className="grid grid-cols-1 gap-2">
            {PLAYGROUND_THEME_KEYS.map((key) => THEME_REGISTRY[key]).map((entry) => {
              const selected = activeConfig.themeKey === entry.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  aria-label={`Select ${entry.name} theme`}
                  aria-pressed={selected}
                  onClick={() => selectTheme(entry.key)}
                  className={`flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors ${
                    selected ? "border-primary ring-1 ring-primary" : "border-border hover:bg-black/[0.02]"
                  }`}
                >
                  <div className="flex overflow-hidden rounded-md border border-border" aria-hidden>
                    {[entry.defaultTokens.colors.primary, entry.defaultTokens.colors.secondary, entry.defaultTokens.colors.accent].map(
                      (c, i) => (
                        <span key={i} className="h-6 flex-1" style={{ backgroundColor: c }} />
                      )
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-semibold text-foreground">{entry.name}</strong>
                    {selected && <Badge tone="success">Active</Badge>}
                  </div>
                  <p className="text-[10px] font-medium uppercase tracking-wide text-primary">{entry.styleTags.join(" · ")}</p>
                  <p className="text-xs text-muted">{entry.description}</p>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Brand colors</legend>
          <div className="grid grid-cols-2 gap-3">
            {COLOR_FIELDS.map((f) => {
              const value = activeConfig.colors[f.key] ?? "";
              const invalid = value !== "" && !isValidHex(value);
              return (
                <label key={f.key} className="flex flex-col gap-1 text-sm">
                  <span className="text-foreground">{f.label}</span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={isValidHex(value) ? value : "#ffffff"}
                      onChange={(e) => updateColor(f.key, e.target.value)}
                      className="h-8 w-9 shrink-0 cursor-pointer rounded-md border border-border"
                      aria-label={`${f.label} color picker`}
                    />
                    <input
                      value={value}
                      onChange={(e) => updateColor(f.key, e.target.value)}
                      placeholder="Default"
                      maxLength={7}
                      className={`${inputClass} w-full min-w-0 ${invalid ? "border-danger" : ""}`}
                      aria-invalid={invalid}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Page sections</legend>
          {OPTIONAL_SECTIONS.map((s) => (
            <label key={s.key} className="flex items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={activeConfig.sections[s.key] === true}
                onChange={(e) => updateSection(s.key, e.target.checked)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              <span className="text-foreground">{s.label}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">Preview device</legend>
          <div className="flex gap-2">
            {DEVICES.map((d) => (
              <button
                key={d.key}
                type="button"
                aria-pressed={device === d.key}
                onClick={() => setDevice(d.key)}
                className={`flex-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                  device === d.key ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-black/[0.02]"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Button type="button" variant="ghost" size="sm" onClick={resetToOriginal}>
          Reset to original
        </Button>
      </div>

      <div className="flex justify-center overflow-x-auto rounded-2xl border border-border bg-background p-2 sm:p-4">
        <div
          data-testid="device-frame"
          className="max-h-[80vh] w-full overflow-y-auto rounded-xl border border-border bg-background shadow-sm transition-[max-width] duration-300 motion-reduce:transition-none"
          style={{ maxWidth: activeDevice.maxWidth }}
        >
          <MenuPage />
        </div>
      </div>
    </div>
  );
}
