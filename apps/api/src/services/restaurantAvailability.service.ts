import type { RestaurantAvailability } from "@restaurant/types";

/**
 * Deliberately does not factor in businessHours: that would make ordering availability depend
 * on wall-clock time, which is a genuinely bigger feature (timezone handling, "closes in 5
 * minutes" edge cases, scheduled-ahead orders) than Phase 2 needs. orderingEnabled/
 * temporarilyPaused are the two restaurant-controlled, deterministic signals; businessHours
 * stays informational/display-only until that scheduling work is actually scoped.
 */
export function computeAvailability(settings: {
  orderingEnabled: boolean;
  temporarilyPaused: boolean;
  pausedReason?: string | null;
}): RestaurantAvailability {
  if (!settings.orderingEnabled) return { status: "closed" };
  if (settings.temporarilyPaused) return { status: "paused", reason: settings.pausedReason ?? undefined };
  return { status: "open" };
}
