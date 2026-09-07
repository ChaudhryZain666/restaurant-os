import type { RestaurantAvailability } from "@restaurant/types";
import { getNextOpenAt, isWithinBusinessHours, type BusinessHoursDayLike } from "./businessHours.service.js";

/**
 * The single server-authoritative answer to "can this restaurant accept an order right now" —
 * every order-creation path (online checkout, POS, delivery, pickup, dine-in) and every
 * storefront/admin read-path funnels through this one function (see orderCreation.service.ts,
 * restaurant.controller.ts, order.controller.ts). Precedence, highest first:
 *
 * 1. `orderingEnabled:false` — the indefinite kill switch. Always closed, regardless of hours.
 * 2. `temporarilyPaused` — a deliberate manual override ("86'd for the night"). Always paused,
 *    regardless of hours — a restaurant inside its configured hours can still choose to pause.
 * 3. Phase 51 — outside `businessHours` (evaluated in the restaurant's own IANA `timezone`, via
 *    businessHours.service.ts). Closed, with `nextOpenAt` when a next opening could be determined.
 * 4. Otherwise open.
 *
 * An EMPTY `businessHours` array (the default for any restaurant that hasn't configured hours —
 * true of every restaurant that existed before this phase) is deliberately treated as "no
 * hours-based restriction" by businessHours.service.ts, not "always closed" — see that file's own
 * doc comment. This is what keeps this a backward-compatible addition rather than a silent mass
 * closure.
 */
export function computeAvailability(
  settings: {
    orderingEnabled: boolean;
    temporarilyPaused: boolean;
    pausedReason?: string | null;
    businessHours: BusinessHoursDayLike[];
    timezone: string;
  },
  now: Date = new Date()
): RestaurantAvailability {
  if (!settings.orderingEnabled) return { status: "closed" };
  if (settings.temporarilyPaused) return { status: "paused", reason: settings.pausedReason ?? undefined };

  const { withinHours } = isWithinBusinessHours(settings.businessHours, settings.timezone, now);
  if (!withinHours) {
    const nextOpenAt = getNextOpenAt(settings.businessHours, settings.timezone, now);
    return { status: "closed", reason: "Outside business hours", nextOpenAt: nextOpenAt?.toISOString() };
  }

  return { status: "open" };
}
