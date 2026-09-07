/**
 * Order-time display for restaurant-operations screens (order cards, status history) needs to
 * match the physical restaurant's wall clock — staff coordinating "this came in at 6:45" are
 * comparing against the kitchen's own clock, not whatever timezone their browser/device happens
 * to be set to. Customer-facing and platform-admin-facing timestamps deliberately keep using the
 * viewer's own local time (Date#toLocaleString with no timeZone override) since those are read
 * from the viewer's own frame of reference, not the restaurant's — this helper is intentionally
 * only used on the restaurant-operations surfaces where that distinction actually matters.
 */
export function formatRestaurantTime(date: Date | string, timezone: string | undefined | null): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: timezone ?? undefined }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

export function formatRestaurantDateTime(date: Date | string, timezone: string | undefined | null): string {
  const d = typeof date === "string" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone ?? undefined }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

function localDateKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function daysBetweenLocalDateKeys(fromKey: string, toKey: string): number {
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/**
 * Phase 51 — which calendar day it is in the RESTAURANT's own timezone right now, not the viewer's
 * browser. Used for "which hours row is today" display (see the theme Footer components) — a
 * viewer in a different timezone than the restaurant must still see the restaurant's own today
 * highlighted, not their own. Falls back to the viewer's local day for a missing/invalid timezone,
 * same convention as formatRestaurantTime/formatRestaurantDateTime.
 */
export function getLocalWeekday(timezone: string | undefined | null, now: Date = new Date()): (typeof WEEKDAY_NAMES)[number] {
  if (!timezone) return WEEKDAY_NAMES[now.getDay()];
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(now).toLowerCase();
    const match = (WEEKDAY_NAMES as readonly string[]).indexOf(weekday);
    return match >= 0 ? WEEKDAY_NAMES[match] : WEEKDAY_NAMES[now.getDay()];
  } catch {
    return WEEKDAY_NAMES[now.getDay()];
  }
}

/**
 * Phase 51 — the one place the human-readable "why can't I order right now" phrase gets built,
 * shared by the storefront and the admin portal so this logic exists exactly once (see
 * apps/api/src/services/restaurantAvailability.service.ts for the server-authoritative status
 * this describes; this function only ever formats what the server already decided, never
 * re-derives it). Deliberately shows the RESTAURANT's own local time for the opening time, not the
 * viewer's — unlike order timestamps (which are about a specific past instant, shown in whichever
 * frame the viewer cares about), a business's stated hours are a fact about that business's own
 * clock, the same way a physical storefront's posted hours sign is always read in its own local
 * time regardless of who's reading it.
 *
 * Structural, not import-coupled to @restaurant/types' RestaurantAvailability — this package has
 * no dependency on that one and doesn't need one just for this shape.
 */
export function describeAvailability(
  availability: { status: "open" | "closed" | "paused"; reason?: string; nextOpenAt?: string } | null | undefined,
  timezone: string | undefined | null,
  now: Date = new Date()
): string {
  if (!availability || availability.status === "open") return "Open";
  if (availability.status === "paused") return availability.reason || "Temporarily paused";

  // status === "closed"
  if (!availability.nextOpenAt) return availability.reason || "Closed";
  const nextOpen = new Date(availability.nextOpenAt);
  const timeLabel = formatRestaurantTime(nextOpen, timezone);
  if (!timezone) return `Opens at ${timeLabel}`;

  const diffDays = daysBetweenLocalDateKeys(localDateKey(now, timezone), localDateKey(nextOpen, timezone));
  if (diffDays <= 0) return `Opens at ${timeLabel}`;
  if (diffDays === 1) return `Opens tomorrow at ${timeLabel}`;
  const dateLabel = new Intl.DateTimeFormat(undefined, { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(nextOpen);
  return `Opens ${dateLabel} at ${timeLabel}`;
}
