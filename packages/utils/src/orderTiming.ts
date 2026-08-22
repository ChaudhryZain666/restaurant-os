interface StatusHistoryEntry {
  status: string;
  at: string;
}

/**
 * Derives a status's timestamp from the order's existing statusHistory rather than a dedicated
 * schema field — every transition is already recorded there (Order.statusHistory,
 * apps/api/src/models/Order.ts), so a separate acceptedAt/preparingAt/readyAt field would just be
 * a redundant copy of data that already exists and could drift out of sync with it.
 */
export function getStatusTimestamp(statusHistory: StatusHistoryEntry[], status: string): Date | undefined {
  const entry = statusHistory.find((h) => h.status === status);
  return entry ? new Date(entry.at) : undefined;
}

/** "3m", "1h 12m" — never seconds (too noisy for a screen meant to be glanced at, not stared at). */
export function formatElapsed(since: Date, now: Date = new Date()): string {
  const totalMinutes = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}
