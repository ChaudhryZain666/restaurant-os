import { formatRestaurantDateTime, formatRestaurantTime } from "@restaurant/utils";

/**
 * Phase 17 — OrdersManagementPage's order-time/status-history displays used to render via the
 * viewer's browser timezone (Date#toLocaleString with no override), which drifts from the
 * restaurant's own wall clock whenever staff views the page from outside the restaurant's
 * timezone. These prove the restaurant-timezone override actually takes effect, mirroring the
 * DST-crossing proof already established for analytics' timezoneAwareDayStart.
 */
describe("formatRestaurantTime / formatRestaurantDateTime (Phase 17)", () => {
  // 2026-08-20T23:30:00Z — late evening UTC, which is already the next calendar day in Karachi
  // (UTC+5, no DST) but still the same evening in New York (UTC-4 in August, DST-active).
  const instant = "2026-08-20T23:30:00.000Z";

  test("renders the restaurant's local clock time, not the viewer's", () => {
    const karachi = formatRestaurantTime(instant, "Asia/Karachi");
    const newYork = formatRestaurantTime(instant, "America/New_York");
    // Karachi is UTC+5: 23:30 UTC -> 04:30 the next day.
    expect(karachi).toMatch(/4:30/);
    // New York is UTC-4 in August (EDT): 23:30 UTC -> 19:30 the same day.
    expect(newYork).toMatch(/7:30/);
    expect(karachi).not.toBe(newYork);
  });

  test("renders the restaurant's local calendar date, which can differ from UTC's", () => {
    const karachi = formatRestaurantDateTime(instant, "Asia/Karachi");
    // 23:30 UTC on the 20th is already 04:30 on the 21st in Karachi.
    expect(karachi).toContain("21");
    expect(karachi).not.toContain(", 20,");
  });

  test("falls back to the viewer's local time for a missing/invalid timezone instead of throwing", () => {
    expect(() => formatRestaurantTime(instant, undefined)).not.toThrow();
    expect(() => formatRestaurantTime(instant, null)).not.toThrow();
    expect(() => formatRestaurantTime(instant, "not-a-real-timezone")).not.toThrow();
  });
});
