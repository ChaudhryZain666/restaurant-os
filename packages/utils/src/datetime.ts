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
