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
 * Phase 22 added a SECOND resolution path, additive to the one above, never replacing it: on a
 * bare storefront-shaped route (`/`, `/cart`, `/t/:tableToken`, `/loyalty` — exactly the routes
 * App.tsx's LegacyRedirect renders) where no `/r/:slug` segment exists, this context attempts to
 * resolve the restaurant from the browser's own `window.location.hostname` via the public
 * `GET /restaurants/by-domain/:hostname` endpoint, BEFORE LegacyRedirect falls back to
 * VITE_RESTAURANT_SLUG. This is how a white-label custom domain (e.g. orders.acme-restaurants.com)
 * shows its storefront with no `/r/:slug` prefix ever visible — see
 * docs/multi-tenant-storefront-architecture.md's Phase 22 section. `window.location.hostname` is
 * the one thing here that's unspoofable (it's literally the browser's address bar), so no
 * Host-header trust question arises: this is the same public, unauthenticated, "anyone can look up
 * any hostname's already-public storefront data" trust model `by-slug` already has.
 *
 * `VITE_RESTAURANT_SLUG` is kept only as the target for legacy bare-URL redirects when NEITHER a
 * `/r/:slug` segment NOR an active custom domain resolves the current request (pre-Phase-8 links/
 * QR codes/bookmarks on a deployment with no custom domain) — see App.tsx's LegacyRedirect.
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
  /** The slug this context resolved (or attempted to resolve) — null before any route match, and
   *  always null when resolved via a custom domain instead (see resolvedVia). */
  slug: string | null;
  /** True on /r/:slug/preview — an authenticated, tenant-scoped owner/platform_admin view that
   *  works even while the restaurant is still pending (see restaurant.controller.ts's
   *  previewRestaurantBySlug). Never true for the real public route, and never reachable by an
   *  anonymous customer regardless of restaurant status. */
  isPreview: boolean;
  /** "slug" | "domain" | "none" — which resolution path (if any) produced `restaurant`. LegacyRedirect
   *  uses this to decide whether to render the real page directly (domain) or fall back to the
   *  VITE_RESTAURANT_SLUG redirect (none). Never meaningful while `loading` is true. */
  resolvedVia: "slug" | "domain" | "none";
}

const RestaurantContext = createContext<RestaurantContextValue | undefined>(undefined);

const BARE_STOREFRONT_PATHS = [/^\/$/, /^\/cart$/, /^\/loyalty$/, /^\/t\/[^/]+$/];

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const publicMatch = useMatch("/r/:restaurantSlug/*");
  const previewMatch = useMatch("/r/:restaurantSlug/preview");
  const isPreview = Boolean(previewMatch);
  const slug = publicMatch?.params.restaurantSlug ?? null;
  // Recomputed on every render (not memoized) — router navigation already re-renders this
  // provider's subtree, and this is a handful of regex tests against a short string, not worth the
  // extra hook.
  const isBareStorefrontPath = !slug && BARE_STOREFRONT_PATHS.some((re) => re.test(window.location.pathname));

  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [availability, setAvailability] = useState<RestaurantAvailability | null>(null);
  const [supportIdentity, setSupportIdentity] = useState<SupportIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedVia, setResolvedVia] = useState<"slug" | "domain" | "none">("none");

  useEffect(() => {
    if (!slug && !isBareStorefrontPath) {
      // Not on a /r/:restaurantSlug/* route or a bare storefront-shaped route (e.g. /login,
      // /orders, /support) — nothing to resolve.
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const path = slug
      ? isPreview
        ? `/restaurants/by-slug/${slug}/preview`
        : `/restaurants/by-slug/${slug}`
      : `/restaurants/by-domain/${window.location.hostname}`;
    // The by-slug public path and the by-domain path are both deliberately unauthenticated for
    // anonymous customers — skipping a refresh attempt there is just an optimization. The preview
    // path REQUIRES a real, refreshable session (it's owner/platform_admin only), so it must not
    // skip refresh.
    const skipRefresh = !(slug && isPreview);

    apiClient
      .request<{ restaurant: Restaurant; availability: RestaurantAvailability; supportIdentity: SupportIdentity }>(path, {
        skipRefresh,
      })
      .then((data) => {
        if (cancelled) return;
        setRestaurant(data.restaurant);
        setAvailability(data.availability);
        setSupportIdentity(data.supportIdentity);
        setResolvedVia(slug ? "slug" : "domain");
      })
      .catch((err) => {
        if (cancelled) return;
        setRestaurant(null);
        setAvailability(null);
        setResolvedVia("none");
        // A failed by-domain lookup (this hostname isn't an active custom domain) is the routine,
        // expected outcome for anyone on the platform's own bare domain — not a real error state.
        // LegacyRedirect falls back silently rather than surfacing this `error` value anywhere.
        setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, isPreview, isBareStorefrontPath]);

  return (
    <RestaurantContext.Provider
      value={{ restaurant, availability, supportIdentity, loading, error, slug, isPreview, resolvedVia }}
    >
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
