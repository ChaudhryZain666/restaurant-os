import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";

/**
 * Phase 0: the storefront serves a single hardcoded restaurant (by slug, via env),
 * bootstrapped once on load. Real per-domain / multi-restaurant storefront routing
 * is future work — see docs/roadmap.md.
 */
const RESTAURANT_SLUG = import.meta.env.VITE_RESTAURANT_SLUG ?? "demo-restaurant";

interface RestaurantContextValue {
  restaurant: Restaurant | null;
  loading: boolean;
  error: string | null;
}

const RestaurantContext = createContext<RestaurantContextValue | undefined>(undefined);

export function RestaurantProvider({ children }: { children: ReactNode }) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>(`/restaurants/by-slug/${RESTAURANT_SLUG}`, { skipRefresh: true })
      .then((data) => setRestaurant(data.restaurant))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <RestaurantContext.Provider value={{ restaurant, loading, error }}>{children}</RestaurantContext.Provider>
  );
}

export function useRestaurant() {
  const ctx = useContext(RestaurantContext);
  if (!ctx) throw new Error("useRestaurant must be used within RestaurantProvider");
  return ctx;
}
