import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMatch } from "react-router-dom";
import type { Restaurant, RestaurantAvailability, SupportIdentity } from "@restaurant/types";
import { apiClient } from "../lib/api";

/**
 * Phase 8: the storefront is genuinely multi-tenant — the restaurant is resolved from the
 * `/r/:restaurantSlug/*` URL segment (see docs/multi-tenant-storefront-architecture.md), not a
 * single env-configured slug. `useMatch` (not `useParams`) is used deliberately: this provider is
 * mounted once, above <Routes>, and needs to work no matter which restaurant-scoped page is
 * active — the same pattern TableContext already established for `/t/:tableToken` in Phase 7.
 *
 * `VITE_RESTAURANT_SLUG` is kept only as the target for legacy bare-URL redirects (`/`, `/cart`,
 * `/t/:token` — pre-Phase-8 links/QR codes/bookmarks) — see App.tsx's LegacyRedirect. It is no
 * longer the storefront's primary source of restaurant identity.
 *
 * Deliberately no `?? "demo-restaurant"` fallback (Phase 13 audit finding): a real deployment
 * that forgets to set this env var would otherwise silently redirect every bare-URL visitor into
 * a restaurant that doesn't exist in its database, since "demo-restaurant" is only ever real in
 * this repo's own local/seeded environment. `apps/web/.env`/`.env.example` still set it explicitly
 * for local dev, so nothing here changes for that case — only an unconfigured deployment now gets
 * an honest "not configured" state (see LegacyRedirect in App.tsx) instead of a broken redirect.
 */
const LEGACY_DEFAULT_SLUG: string | undefined = import.meta.env.VITE_RESTAURANT_SLUG;

interface RestaurantContextValue {
  restaurant: Restaurant | null;
  availability: RestaurantAvailability | null;
  /** Customer-facing support identity ("Platform Support" today — see supportIdentity.service.ts). */
  supportIdentity: SupportIdentity | null;
  loading: boolean;
  error: string | null;
  /** The slug this context resolved (or attempted to resolve) — null before any route match. */
  slug: string | null;
  /** True on /r/:slug/preview — an authenticated, tenant-scoped owner/platform_admin view that
   *  works even while the restaurant is still pending (see restaurant.controller.ts's
   *  previewRestaurantBySlug). Never true for the real public route, and never reachable by an
   *  anonymous customer regardless of restaurant status. */
  isPreview: boolean;
}

const RestaurantContext = createContext<RestaurantContextValue | undefined>(undefined);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const publicMatch = useMatch("/r/:restaurantSlug/*");
  const previewMatch = useMatch("/r/:restaurantSlug/preview");
  const isPreview = Boolean(previewMatch);
  const slug = publicMatch?.params.restaurantSlug ?? null;

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [availability, setAvailability] = useState<RestaurantAvailability | null>(null);
  const [supportIdentity, setSupportIdentity] = useState<SupportIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) {
      // Not on a /r/:restaurantSlug/* route (e.g. /login, /orders, a legacy URL still mid-redirect)
      // — nothing to resolve; App.tsx's LegacyRedirect handles bare storefront URLs.
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path = isPreview ? `/restaurants/by-slug/${slug}/preview` : `/restaurants/by-slug/${slug}`;
    apiClient
      .request<{ restaurant: Restaurant; availability: RestaurantAvailability; supportIdentity: SupportIdentity }>(
        path,
        // The public path is deliberately unauthenticated for anonymous customers — skipping a
        // refresh attempt there is just an optimization. The preview path REQUIRES a real,
        // refreshable session (it's owner/platform_admin only), so it must not skip refresh.
        { skipRefresh: !isPreview }
      )
      .then((data) => {
        if (cancelled) return;
        setRestaurant(data.restaurant);
        setAvailability(data.availability);
        setSupportIdentity(data.supportIdentity);
      })
      .catch((err) => {
        if (cancelled) return;
        setRestaurant(null);
        setAvailability(null);
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, isPreview]);

  return (
    <RestaurantContext.Provider value={{ restaurant, availability, supportIdentity, loading, error, slug, isPreview }}>
      {children}
    </RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) throw new Error("useRestaurant must be used within RestaurantProvider");
  return ctx;
}

/** The restaurant a bare legacy URL (/, /cart, /t/:token) should redirect to — see App.tsx.
 *  Undefined when this deployment never configured VITE_RESTAURANT_SLUG. */
export function legacyDefaultSlug(): string | undefined {
  return LEGACY_DEFAULT_SLUG;
}
