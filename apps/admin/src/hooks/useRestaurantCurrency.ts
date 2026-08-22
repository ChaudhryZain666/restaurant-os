import { useEffect, useState } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

/** Pages that only need the restaurant's currency code (not the full settings object) fetch it
 *  here instead of duplicating a fetch call — defaults to "USD" while loading so formatCurrency
 *  has something sane to fall back on before the request resolves.
 *
 *  Phase 19 — reads the ACTIVE location, not a fixed /restaurants/me call: /me resolves purely
 *  from the JWT's own baked-in restaurantId, which would keep showing a multi-location user's
 *  ORIGINAL location's currency even after switching to a different one. */
export function useRestaurantCurrency(): string {
  const restaurantId = useActiveLocationId();
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`)
      .then((data) => setCurrency(data.restaurant.settings.currency))
      .catch(() => {});
  }, [restaurantId]);

  return currency;
}
