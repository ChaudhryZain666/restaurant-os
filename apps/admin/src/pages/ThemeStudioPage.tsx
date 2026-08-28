import { useEffect, useState } from "react";
import type { RestaurantThemeConfig, ThemeDensity, ThemeRadiusScale, ThemeSectionKey } from "@restaurant/types";
import { THEME_DENSITIES, THEME_RADIUS_SCALES, normalizeThemeConfig } from "@restaurant/types";
import { Alert, Badge, Button, HEX_COLOR_PATTERN, useToast } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { THEME_CATALOG } from "../lib/themeCatalog";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface ThemeResponse {
  published: RestaurantThemeConfig;
  draft: RestaurantThemeConfig | null;
  hasUnpublishedChanges: boolean;
}

const COLOR_FIELDS = [
  { key: "primary", label: "Primary" },
  { key: "secondary", label: "Secondary" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Background" },
] as const;

const OPTIONAL_SECTIONS: { key: Exclude<ThemeSectionKey, "hero">; label: string; hint: string }[] = [
  { key: "featured", label: "Popular picks", hint: "A short highlight strip of menu items near the top of the page." },
  { key: "about", label: "Our story", hint: "Your restaurant's description, shown as its own section." },
  { key: "gallery", label: "Gallery", hint: "Your cover photo and logo, shown as a small gallery." },
  { key: "cta", label: "Closing call-to-action", hint: "A final \"ready to order?\" prompt at the bottom of the page." },
];

function isValidHex(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Phase 31 — Theme Studio: pick one of the storefront's structurally different themes, adjust
 * branding within that theme's guardrails (a handful of hex colors, a radius/density feel, which
 * optional sections show), and publish. Deliberately NOT a page builder: there is no free-text CSS/
 * HTML anywhere here — every control is a closed enum or a hex color, matching
 * packages/validation/src/theme.ts's `.strict()` schema exactly, so nothing this page can produce
 * could ever fail that validation.
 *
 * "Preview" opens `/r/:slug/preview` — the SAME renderer a real customer sees, with the draft
 * substituted in for the published theme server-side (see restaurant.controller.ts's
 * toPreviewRestaurant) — never a second, admin-only preview renderer.
 */
export function ThemeStudioPage() {
  const { restaurant } = useRestaurantSettings();
  const { showToast } = useToast();

  const [themeData, setThemeData] = useState<ThemeResponse | null>(null);
  const [draft, setDraft] = useState<RestaurantThemeConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (!restaurant) return;
    let cancelled = false;
    setLoading(true);
    apiClient
      .request<ThemeResponse>(`/restaurants/${restaurant.id}/theme`)
      .then((data) => {
        if (cancelled) return;
        setThemeData(data);
        setDraft(normalizeThemeConfig(data.draft ?? data.published));
      })
      .catch((err) => !cancelled && setError((err as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [restaurant]);

  if (!restaurant || loading) return <p className="text-sm text-muted">Loading theme…</p>;
  if (error && !themeData) return <Alert tone="danger" role="alert">{error}</Alert>;
  if (!draft || !themeData) return null;

  const colorErrors = COLOR_FIELDS.filter((f) => {
    const v = draft.colors[f.key];
    return v !== undefined && !isValidHex(v);
  });

  async function saveDraft(): Promise<boolean> {
    if (colorErrors.length > 0 || !restaurant || !draft) {
      setError("Fix the highlighted color(s) before saving — colors must be a 6-digit hex code like #c2410c.");
      return false;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await apiClient.request<{ draft: RestaurantThemeConfig }>(`/restaurants/${restaurant.id}/theme/draft`, {
        method: "PATCH",
        body: draft,
      });
      setThemeData((prev) => (prev ? { ...prev, draft: res.draft, hasUnpublishedChanges: true } : prev));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveDraft() {
    const ok = await saveDraft();
    if (ok) showToast({ title: "Draft saved", description: "Open Preview to see it, or Publish to make it live." });
  }

  async function handlePublish() {
    const ok = await saveDraft();
    if (!ok || !restaurant) return;
    setPublishing(true);
    try {
      const res = await apiClient.request<{ theme: RestaurantThemeConfig }>(`/restaurants/${restaurant.id}/theme/publish`, {
        method: "POST",
      });
      setThemeData({ published: res.theme, draft: null, hasUnpublishedChanges: false });
      showToast({ title: "Theme published", description: "Your storefront is now live with these changes." });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function handleDiscardDraft() {
    if (!restaurant) return;
    setDiscarding(true);
    try {
      await apiClient.request(`/restaurants/${restaurant.id}/theme/discard-draft`, { method: "POST" });
      setDraft(normalizeThemeConfig(themeData!.published));
      setThemeData((prev) => (prev ? { ...prev, draft: null, hasUnpublishedChanges: false } : prev));
      showToast({ title: "Draft discarded", description: "Reverted to what's currently published." });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDiscarding(false);
    }
  }

  function updateColor(key: (typeof COLOR_FIELDS)[number]["key"], value: string) {
    setDraft((prev) => (prev ? { ...prev, colors: { ...prev.colors, [key]: value || undefined } } : prev));
  }

  function updateSection(key: ThemeSectionKey, shown: boolean) {
    setDraft((prev) => (prev ? { ...prev, sections: { ...prev.sections, [key]: shown } } : prev));
  }

  const previewUrl = `/r/${restaurant.slug}/preview`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Theme Studio</h1>
          <p className="text-sm text-muted">Choose how your storefront looks. Changes only go live when you publish.</p>
        </div>
        <div className="flex items-center gap-2">
          {themeData.hasUnpublishedChanges && <Badge tone="warning">Unpublished changes</Badge>}
          <a href={previewUrl} target="_blank" rel="noreferrer">
            <Button type="button" variant="ghost">
              Preview
            </Button>
          </a>
        </div>
      </div>

      {error && <Alert tone="danger" role="alert">{error}</Alert>}

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Theme</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEME_CATALOG.map((entry) => {
            const selected = draft.themeKey === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                aria-label={`Select ${entry.name} theme`}
                aria-pressed={selected}
                onClick={() => setDraft((prev) => (prev ? { ...prev, themeKey: entry.key } : prev))}
                className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
                  selected ? "border-primary ring-1 ring-primary" : "border-border hover:bg-black/[0.02]"
                }`}
              >
                <div className="flex overflow-hidden rounded-lg border border-border" aria-hidden>
                  {Object.values(entry.swatch).map((c, i) => (
                    <span key={i} className="h-8 flex-1" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-semibold text-foreground">{entry.name}</strong>
                  {selected && <Badge tone="success">Selected</Badge>}
                </div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-primary">{entry.styleTags.join(" · ")}</p>
                <p className="text-xs text-muted">{entry.description}</p>
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Branding</legend>
        <p className="text-xs text-muted">
          Overrides a handful of this theme's colors. Leave a field blank to use the theme's own default for it.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {COLOR_FIELDS.map((f) => {
            const value = draft.colors[f.key] ?? "";
            const invalid = value !== "" && !isValidHex(value);
            return (
              <label key={f.key} className="flex flex-col gap-1 text-sm">
                <span className="text-foreground">{f.label}</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={isValidHex(value) ? value : "#ffffff"}
                    onChange={(e) => updateColor(f.key, e.target.value)}
                    className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border border-border"
                    aria-label={`${f.label} color picker`}
                  />
                  <input
                    value={value}
                    onChange={(e) => updateColor(f.key, e.target.value)}
                    placeholder="Theme default"
                    maxLength={7}
                    className={`${inputClass} w-28 ${invalid ? "border-danger" : ""}`}
                    aria-invalid={invalid}
                  />
                  {value && (
                    <button type="button" onClick={() => updateColor(f.key, "")} className="text-xs text-muted underline">
                      Reset
                    </button>
                  )}
                </div>
                {invalid && <span className="text-xs text-danger">Must be a 6-digit hex code, like #c2410c.</span>}
              </label>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground">Corner style</span>
            <select
              value={draft.radius ?? ""}
              onChange={(e) =>
                setDraft((prev) => (prev ? { ...prev, radius: (e.target.value || undefined) as ThemeRadiusScale | undefined } : prev))
              }
              className={inputClass}
            >
              <option value="">Theme default</option>
              {THEME_RADIUS_SCALES.map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground">Spacing</span>
            <select
              value={draft.density ?? ""}
              onChange={(e) =>
                setDraft((prev) => (prev ? { ...prev, density: (e.target.value || undefined) as ThemeDensity | undefined } : prev))
              }
              className={inputClass}
            >
              <option value="">Theme default</option>
              {THEME_DENSITIES.map((d) => (
                <option key={d} value={d}>
                  {d[0].toUpperCase() + d.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Page sections</legend>
        <p className="text-xs text-muted">Your menu and availability status always show. These extra sections are optional.</p>
        <div className="flex flex-col gap-2">
          {OPTIONAL_SECTIONS.map((s) => (
            <label key={s.key} className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={draft.sections[s.key] === true}
                onChange={(e) => updateSection(s.key, e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
              />
              <span>
                <span className="block font-medium text-foreground">{s.label}</span>
                <span className="block text-xs text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={handlePublish} disabled={saving || publishing || discarding}>
          {publishing ? "Publishing…" : "Publish"}
        </Button>
        <Button type="button" variant="ghost" onClick={handleSaveDraft} disabled={saving || publishing || discarding}>
          {saving ? "Saving…" : "Save draft"}
        </Button>
        {themeData.hasUnpublishedChanges && (
          <Button type="button" variant="ghost" onClick={handleDiscardDraft} disabled={saving || publishing || discarding}>
            {discarding ? "Discarding…" : "Discard draft"}
          </Button>
        )}
      </div>
    </div>
  );
}
