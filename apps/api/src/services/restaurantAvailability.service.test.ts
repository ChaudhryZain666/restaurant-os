import { describe, expect, it } from "@jest/globals";
import type { BusinessHoursDay } from "@restaurant/types";
import { computeAvailability } from "./restaurantAvailability.service.js";

// Every existing test in this file predates Phase 51's businessHours/timezone enforcement — each
// now passes an explicit `businessHours: []` (the documented "no hours-based restriction" default)
// so these assertions keep proving exactly what they always proved (orderingEnabled/
// temporarilyPaused precedence), unaffected by the new hours dimension.
const NO_HOURS = { businessHours: [] as BusinessHoursDay[], timezone: "UTC" };

describe("computeAvailability — orderingEnabled/temporarilyPaused (pre-existing behavior, unchanged)", () => {
  it("is closed when orderingEnabled is false, regardless of the pause flag", () => {
    expect(computeAvailability({ orderingEnabled: false, temporarilyPaused: false, ...NO_HOURS })).toEqual({ status: "closed" });
    expect(computeAvailability({ orderingEnabled: false, temporarilyPaused: true, ...NO_HOURS })).toEqual({ status: "closed" });
  });

  it("is paused when orderingEnabled is true but temporarilyPaused is set", () => {
    expect(
      computeAvailability({ orderingEnabled: true, temporarilyPaused: true, pausedReason: "Back in 20", ...NO_HOURS })
    ).toEqual({ status: "paused", reason: "Back in 20" });
  });

  it("is paused with no reason when pausedReason is absent", () => {
    expect(computeAvailability({ orderingEnabled: true, temporarilyPaused: true, ...NO_HOURS })).toEqual({ status: "paused" });
  });

  it("is open otherwise", () => {
    expect(computeAvailability({ orderingEnabled: true, temporarilyPaused: false, ...NO_HOURS })).toEqual({ status: "open" });
  });
});

describe("computeAvailability — businessHours (Phase 51)", () => {
  const CLOSED_ALL_WEEK: BusinessHoursDay[] = [
    { day: "sunday", isClosed: true },
    { day: "monday", isClosed: true },
    { day: "tuesday", isClosed: true },
    { day: "wednesday", isClosed: true },
    { day: "thursday", isClosed: true },
    { day: "friday", isClosed: true },
    { day: "saturday", isClosed: true },
  ];
  // 2026-01-05 is a Monday.
  const mondayOpen: BusinessHoursDay[] = CLOSED_ALL_WEEK.map((d) =>
    d.day === "monday" ? { day: d.day, isClosed: false, open: "09:00", close: "17:00" } : d
  );

  it("an empty businessHours array places no restriction on ordering", () => {
    expect(
      computeAvailability(
        { orderingEnabled: true, temporarilyPaused: false, businessHours: [], timezone: "UTC" },
        new Date("2026-01-05T03:00:00.000Z") // 3am — would be closed under any real hours
      )
    ).toEqual({ status: "open" });
  });

  it("is closed, with a reason and nextOpenAt, outside configured hours", () => {
    const result = computeAvailability(
      { orderingEnabled: true, temporarilyPaused: false, businessHours: mondayOpen, timezone: "UTC" },
      new Date("2026-01-05T20:00:00.000Z") // 8pm Monday — past the 17:00 close
    );
    expect(result.status).toBe("closed");
    expect(result.reason).toBe("Outside business hours");
    // Every other day is closed all week, so the next real opening is the FOLLOWING Monday
    // (2026-01-05 + 7 days = 2026-01-12, also a Monday).
    expect(result.nextOpenAt).toBe("2026-01-12T09:00:00.000Z");
  });

  it("is open within configured hours", () => {
    expect(
      computeAvailability(
        { orderingEnabled: true, temporarilyPaused: false, businessHours: mondayOpen, timezone: "UTC" },
        new Date("2026-01-05T12:00:00.000Z")
      )
    ).toEqual({ status: "open" });
  });

  it("evaluates hours using the restaurant's OWN timezone, not UTC", () => {
    // 2026-01-05T20:00:00Z is 8pm UTC Monday (closed under a UTC-evaluated 09:00-17:00), but only
    // 1pm in America/Chicago (UTC-6 in January) — squarely within the same configured hours.
    expect(
      computeAvailability(
        { orderingEnabled: true, temporarilyPaused: false, businessHours: mondayOpen, timezone: "America/Chicago" },
        new Date("2026-01-05T20:00:00.000Z")
      )
    ).toEqual({ status: "open" });
  });

  it("orderingEnabled:false wins over hours — closed even during configured open hours", () => {
    expect(
      computeAvailability(
        { orderingEnabled: false, temporarilyPaused: false, businessHours: mondayOpen, timezone: "UTC" },
        new Date("2026-01-05T12:00:00.000Z")
      )
    ).toEqual({ status: "closed" });
  });

  it("temporarilyPaused wins over hours — paused even during configured open hours", () => {
    expect(
      computeAvailability(
        { orderingEnabled: true, temporarilyPaused: true, pausedReason: "86'd for the night", businessHours: mondayOpen, timezone: "UTC" },
        new Date("2026-01-05T12:00:00.000Z")
      )
    ).toEqual({ status: "paused", reason: "86'd for the night" });
  });

  it("a day missing from a non-empty array is closed that day", () => {
    const onlyMonday: BusinessHoursDay[] = [{ day: "monday", isClosed: false, open: "09:00", close: "17:00" }];
    // 2026-01-06 is a Tuesday, with no entry at all in `onlyMonday`.
    const result = computeAvailability(
      { orderingEnabled: true, temporarilyPaused: false, businessHours: onlyMonday, timezone: "UTC" },
      new Date("2026-01-06T12:00:00.000Z")
    );
    expect(result.status).toBe("closed");
  });
});
