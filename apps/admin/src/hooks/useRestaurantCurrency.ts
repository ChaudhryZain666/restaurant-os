import { useEffect, useState } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";

/** Pages that only need the restaurant's currency code (not the full settings object) fetch it
 *  here instead of duplicating a `/restaurants/me` call — defaults to "USD" while loading so
 *  formatCurrency has something sane to fall back on before the request resolves. */
export function useRestaurantCurrency(): string {
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>("/restaurants/me")
      .then((data) => setCurrency(data.restaurant.settings.currency))
      .catch(() => {});
  }, []);

  return currency;
}
