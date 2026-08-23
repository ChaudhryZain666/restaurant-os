import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { socket, setActiveLocationIdForSocket } from "../lib/socket";
import { useAuth } from "./AuthContext";
import { useBusiness } from "./BusinessContext";

interface LocationContextValue {
  /** The location (Restaurant) currently being operated on. Null only while still resolving. */
  activeLocationId: string | null;
  /** Every location this user can reach — a single entry for the (still overwhelmingly common)
   *  single-location case, so callers should check .length, not just truthiness, before deciding
   *  whether to show any multi-location UI at all (see Layout.tsx's switcher). */
  locations: Restaurant[];
  loading: boolean;
  switchLocation: (locationId: string) => void;
  /** Re-fetches the accessible-locations list without disturbing the active location or the
   *  socket connection — for LocationsPage.tsx to call right after creating a new location, so
   *  the newly created one shows up (and becomes switchable) without a full page reload. */
  refetchLocations: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue | undefined>(undefined);

function storageKey(businessId: string) {
  return `activeLocationId:${businessId}`;
}

/**
 * Phase 19 — the admin-app analog of apps/web's RestaurantContext, except the "which restaurant"
 * question here is never trusted from a URL: every admin route is bare ("/orders", not
 * "/orders/:restaurantId"), so the active location is purely client-side UI state layered on top
 * of server-side authorization that's independently correct regardless of what this context thinks
 * is "active" (every request still goes through the real requireTenantMatch check — see
 * middleware/tenant.ts). localStorage here is a UI preference, never an authorization input.
 *
 * Resolution order for the initial active location: a valid, still-accessible localStorage
 * preference for this business > the user's own original restaurantId (still accessible, since
 * requireTenantMatch's fast path always grants that one) > the first location in the accessible
 * list.
 *
 * The socket's own connect() trigger lives HERE, not in AuthContext, specifically to avoid a
 * guaranteed double-connect: connecting the instant `user` is set (AuthContext's old behavior)
 * would race ahead of this context's async GET /businesses/:businessId/locations call, connect
 * once with whatever the JWT's baked-in restaurantId is, and then need a second, immediate
 * reconnect once the real active-location preference resolves. Waiting for that resolution first
 * costs at most one extra render before the very first connection.
 *
 * Phase 26 — the single load-bearing change: reads `activeBusinessId` from BusinessContext instead
 * of `user.businessId` directly. For a real restaurant-role account those are always identical
 * (BusinessContext computes activeBusinessId AS user.businessId for those roles), so this is a
 * behavior-neutral substitution for every existing account. For an agency_member, BusinessContext
 * supplies the business they've explicitly entered (or null) — which is what makes every existing
 * operational page (Menu/Orders/Kitchen/Staff/...) work for an acting-as-agency session with zero
 * page-level changes, since they all resolve their scope through this context or user.businessId,
 * never a URL param.
 */
export function LocationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { activeBusinessId } = useBusiness();
  const [locations, setLocations] = useState<Restaurant[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!user) {
        setLocations([]);
        setActiveLocationId(null);
        setLoading(false);
        socket.disconnect();
        return;
      }

      if (!activeBusinessId) {
        // Not yet migrated / no business context at all (or an agency member who hasn't entered a
        // managed business yet) — fall back to the single restaurantId this account has always had
        // (undefined for an agency member, which correctly resolves to no active location at all).
        // No multi-location UI will ever render for this account (locations stays empty), matching
        // Section 5's "don't complicate the single-location product" requirement by construction,
        // not by a special case.
        setLocations([]);
        setActiveLocationId(user.restaurantId ?? null);
        setLoading(false);
        setActiveLocationIdForSocket(user.restaurantId ?? null);
        socket.connect();
        return;
      }

      setLoading(true);
      try {
        const { locations: fetched } = await apiClient.request<{ locations: Restaurant[] }>(
          `/businesses/${activeBusinessId}/locations`
        );
        if (cancelled) return;
        setLocations(fetched);

        const stored = localStorage.getItem(storageKey(activeBusinessId));
        const storedStillValid = stored && fetched.some((l) => l.id === stored);
        const fallback = fetched.find((l) => l.id === user.restaurantId)?.id ?? fetched[0]?.id ?? null;
        const resolved = storedStillValid ? stored : fallback;

        setActiveLocationId(resolved);
        setActiveLocationIdForSocket(resolved);
        socket.connect();
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, activeBusinessId]);

  const switchLocation = useCallback(
    (locationId: string) => {
      if (!activeBusinessId || locationId === activeLocationId) return;
      localStorage.setItem(storageKey(activeBusinessId), locationId);
      setActiveLocationId(locationId);
      setActiveLocationIdForSocket(locationId);
      // A real disconnect+reconnect, not a live room-swap — the fresh handshake re-derives room
      // membership from scratch, so there's no risk of a stale restaurant:{oldId} subscription
      // lingering alongside the new one (see socket.ts's server-side handshake logic).
      socket.disconnect();
      socket.connect();
    },
    [activeBusinessId, activeLocationId]
  );

  const refetchLocations = useCallback(async () => {
    if (!activeBusinessId) return;
    const { locations: fetched } = await apiClient.request<{ locations: Restaurant[] }>(
      `/businesses/${activeBusinessId}/locations`
    );
    setLocations(fetched);
  }, [activeBusinessId]);

  const value = useMemo(
    () => ({ activeLocationId, locations, loading, switchLocation, refetchLocations }),
    [activeLocationId, locations, loading, switchLocation, refetchLocations]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error("useLocation must be used within LocationProvider");
  return ctx;
}

/** Convenience for the many pages that just need "my restaurantId" and nothing else — mirrors the
 *  pre-Phase-19 `user!.restaurantId!` call sites exactly, just sourced from the active location
 *  instead of the account's original, fixed restaurantId. */
export function useActiveLocationId(): string {
  return useLocation().activeLocationId!;
}
