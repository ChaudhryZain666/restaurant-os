import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "./LocationContext";

interface RestaurantSettingsContextValue {
  restaurant: Restaurant | null;
  loading: boolean;
  /** Phase 28 — SettingsPage.tsx calls this after a successful save so the Kitchen/Staff nav items
   *  (and any other settings-flag-gated UI) update immediately, without a full page reload. Without
   *  this, toggling a feature off would only take visible effect on the next navigation that
   *  happens to remount this provider. */
  refetch: () => Promise<void>;
}

const RestaurantSettingsContext = createContext<RestaurantSettingsContextValue | undefined>(undefined);

/**
 * Phase 28 — the active location's own Restaurant document (kitchenEnabled/staffEnabled today),
 * shared by Layout.tsx (nav gating) and any page rendered inside it (KitchenPage.tsx/StaffPage.tsx's
 * disabled-state check, SettingsPage.tsx's save-then-refetch). One fetch, one shared instance —
 * not a separate fetch per consumer, and not LocationContext's own `locations` array, which stays
 * empty for the common single-location, not-yet-business-migrated account (see that context's own
 * doc comment) and so can't be relied on for this.
 */
export function RestaurantSettingsProvider({ children }: { children: ReactNode }) {
  const restaurantId = useActiveLocationId();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiClient.request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`);
      setRestaurant(res.restaurant);
    } catch {
      setRestaurant(null);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const value = useMemo(() => ({ restaurant, loading, refetch }), [restaurant, loading, refetch]);
  return <RestaurantSettingsContext.Provider value={value}>{children}</RestaurantSettingsContext.Provider>;
}

export function useRestaurantSettings() {
  const ctx = useContext(RestaurantSettingsContext);
  if (!ctx) throw new Error("useRestaurantSettings must be used within RestaurantSettingsProvider");
  return ctx;
}
