import { useEffect, useState } from "react";
import type { Restaurant } from "@restaurant/types";
import { apiClient } from "../lib/api";

/** Mirrors useRestaurantCurrency — fetches just the restaurant's configured IANA timezone for
 *  screens that need to render times against the restaurant's own wall clock (see datetime.ts's
 *  formatRestaurantTime/formatRestaurantDateTime for why that's not always the viewer's browser
 *  timezone). Defaults to undefined while loading, which the formatters treat as "use the
 *  viewer's local timezone" rather than crashing on a missing value. */
export function useRestaurantTimezone(): string | undefined {
  const [timezone, setTimezone] = useState<string | undefined>(undefined);

  useEffect(() => {
    apiClient
      .request<{ restaurant: Restaurant }>("/restaurants/me")
      .then((data) => setTimezone(data.restaurant.settings.timezone))
      .catch(() => {});
  }, []);

  return timezone;
}
