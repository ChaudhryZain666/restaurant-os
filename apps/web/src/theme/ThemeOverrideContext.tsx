import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { normalizeThemeConfig, type RestaurantThemeConfig } from "@restaurant/types";

/**
 * Phase 32 — the public storefront-playground's client-only theme override. Lets a visitor on
 * /r/:slug/experience live-edit a RestaurantThemeConfig without ever touching the real
 * settings.theme/themeDraft on the server: nothing here calls the theme.controller.ts draft/
 * publish/discard endpoints, so there is no persisted mutation for another visitor (or the real
 * owner) to ever see. Scoped to `slug` — ThemeProvider only applies `config` when it matches the
 * CURRENTLY RESOLVED restaurant's slug, so a same-tab client-side navigation to an unrelated
 * restaurant can never inherit this override (React context state otherwise persists across route
 * changes without a full reload).
 *
 * Persisted to sessionStorage (not localStorage) so a reload of the same tab keeps an in-progress
 * customization, but a fresh tab/visitor never sees another visitor's choices — this is the entire
 * mechanism behind "visitor A's customization must never leak to visitor B," with zero backend
 * involvement.
 */
interface ThemeOverride {
  slug: string;
  config: RestaurantThemeConfig;
}

interface ThemeOverrideContextValue {
  override: ThemeOverride | null;
  setOverride: (slug: string, config: RestaurantThemeConfig) => void;
  updateOverride: (slug: string, patch: Partial<RestaurantThemeConfig>) => void;
  clearOverride: () => void;
}

const STORAGE_KEY = "tablecloth:demoThemeOverride:v1";

const ThemeOverrideContext = createContext<ThemeOverrideContextValue | undefined>(undefined);

function readStored(): ThemeOverride | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThemeOverride;
    if (!parsed?.slug || !parsed?.config) return null;
    return { slug: parsed.slug, config: normalizeThemeConfig(parsed.config) };
  } catch {
    return null;
  }
}

export function ThemeOverrideProvider({ children }: { children: ReactNode }) {
  const [override, setOverrideState] = useState<ThemeOverride | null>(readStored);

  const persist = useCallback((next: ThemeOverride | null) => {
    setOverrideState(next);
    try {
      if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // sessionStorage can throw in a locked-down/private-browsing context — the in-memory state
      // above still works for the rest of this tab's session, just without surviving a reload.
    }
  }, []);

  const setOverride = useCallback(
    (slug: string, config: RestaurantThemeConfig) => persist({ slug, config: normalizeThemeConfig(config) }),
    [persist]
  );

  const updateOverride = useCallback(
    (slug: string, patch: Partial<RestaurantThemeConfig>) => {
      setOverrideState((current) => {
        const base = current?.slug === slug ? current.config : normalizeThemeConfig(undefined);
        const next: ThemeOverride = { slug, config: normalizeThemeConfig({ ...base, ...patch }) };
        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // See persist()'s comment above — non-fatal.
        }
        return next;
      });
    },
    []
  );

  const clearOverride = useCallback(() => persist(null), [persist]);

  const value = useMemo(
    () => ({ override, setOverride, updateOverride, clearOverride }),
    [override, setOverride, updateOverride, clearOverride]
  );

  return <ThemeOverrideContext.Provider value={value}>{children}</ThemeOverrideContext.Provider>;
}

export function useThemeOverride(): ThemeOverrideContextValue {
  const ctx = useContext(ThemeOverrideContext);
  if (!ctx) throw new Error("useThemeOverride must be used within a ThemeOverrideProvider");
  return ctx;
}
