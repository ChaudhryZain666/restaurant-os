import { describeAvailability, formatRestaurantDateTime, formatRestaurantTime, getLocalWeekday } from "@restaurant/utils";

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

/** Phase 51 — the single shared "why is this restaurant unavailable right now" phrase-builder,
 *  used by both the storefront and the admin portal (see packages/utils/src/datetime.ts). */
describe("describeAvailability (Phase 51)", () => {
  test("open", () => {
    expect(describeAvailability({ status: "open" }, "America/Chicago")).toBe("Open");
    expect(describeAvailability(null, "America/Chicago")).toBe("Open");
  });

  test("paused, with and without a reason", () => {
    expect(describeAvailability({ status: "paused", reason: "Back in 20" }, "America/Chicago")).toBe("Back in 20");
    expect(describeAvailability({ status: "paused" }, "America/Chicago")).toBe("Temporarily paused");
  });

  test("closed with no nextOpenAt (e.g. orderingEnabled:false) falls back to a generic message", () => {
    expect(describeAvailability({ status: "closed" }, "America/Chicago")).toBe("Closed");
  });

  test("closed, opening later the same restaurant-local day", () => {
    const now = new Date("2026-01-05T14:00:00.000Z"); // 8am Chicago (UTC-6 in January)
    const nextOpenAt = new Date("2026-01-05T15:00:00.000Z").toISOString(); // 9am Chicago, same day
    expect(describeAvailability({ status: "closed", nextOpenAt }, "America/Chicago", now)).toMatch(/^Opens at 9:00/);
  });

  test("closed, opening the restaurant-local NEXT calendar day — even when that's not yet true in UTC", () => {
    // 11pm Chicago (UTC-6) on 2026-01-05 — still Jan 5 UTC-wise is irrelevant; what matters is
    // Chicago's own local date advancing to Jan 6 by the time it next opens at 9am Chicago.
    const now = new Date("2026-01-06T05:00:00.000Z"); // 11pm Chicago, Jan 5 local
    const nextOpenAt = new Date("2026-01-06T15:00:00.000Z").toISOString(); // 9am Chicago, Jan 6 local
    expect(describeAvailability({ status: "closed", nextOpenAt }, "America/Chicago", now)).toMatch(/^Opens tomorrow at 9:00/);
  });

  test("closed for several days shows an explicit date, never a misleading 'tomorrow'", () => {
    const now = new Date("2026-01-05T14:00:00.000Z");
    const nextOpenAt = new Date("2026-01-08T15:00:00.000Z").toISOString(); // 3 local days later
    const result = describeAvailability({ status: "closed", nextOpenAt }, "America/Chicago", now);
    expect(result).not.toMatch(/tomorrow/i);
    expect(result).toMatch(/^Opens .*9:00/);
  });

  test("uses the restaurant's own local time for the opening time, not the viewer's/UTC", () => {
    const now = new Date("2026-01-05T05:00:00.000Z");
    const nextOpenAt = new Date("2026-01-05T15:00:00.000Z").toISOString(); // 15:00 UTC = 9am Chicago (UTC-6)
    expect(describeAvailability({ status: "closed", nextOpenAt }, "America/Chicago", now)).toContain("9:00");
  });
});

describe("getLocalWeekday (Phase 51)", () => {
  test("returns the restaurant's own local calendar day, which can differ from UTC's/the viewer's", () => {
    // 2026-01-05T20:00:00Z is Monday 8pm UTC — but already 01:00 Tuesday in Karachi (UTC+5).
    const instant = new Date("2026-01-05T20:00:00.000Z");
    expect(getLocalWeekday("Asia/Karachi", instant)).toBe("tuesday");
    expect(getLocalWeekday("America/Chicago", instant)).toBe("monday");
  });

  test("falls back to the local machine's day for a missing/invalid timezone instead of throwing", () => {
    const instant = new Date("2026-01-05T20:00:00.000Z");
    expect(() => getLocalWeekday(undefined, instant)).not.toThrow();
    expect(() => getLocalWeekday("not-a-real-timezone", instant)).not.toThrow();
  });
});
