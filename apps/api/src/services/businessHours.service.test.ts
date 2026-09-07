import { describe, expect, it } from "@jest/globals";
import type { BusinessHoursDay } from "@restaurant/types";
import { getNextOpenAt, isWithinBusinessHours } from "./businessHours.service.js";

const CLOSED: BusinessHoursDay[] = [
  { day: "sunday", isClosed: true },
  { day: "monday", isClosed: true },
  { day: "tuesday", isClosed: true },
  { day: "wednesday", isClosed: true },
  { day: "thursday", isClosed: true },
  { day: "friday", isClosed: true },
  { day: "saturday", isClosed: true },
];

function withDay(day: BusinessHoursDay["day"], open: string, close: string): BusinessHoursDay[] {
  return CLOSED.map((d) => (d.day === day ? { day, isClosed: false, open, close } : d));
}

describe("isWithinBusinessHours — empty/missing hours (backward compatibility)", () => {
  it("an empty businessHours array means no hours-based restriction at all", () => {
    expect(isWithinBusinessHours([], "UTC", new Date("2026-01-05T12:00:00.000Z")).withinHours).toBe(true);
  });

  it("a day simply absent from a non-empty array is treated as closed that day", () => {
    // Only Monday configured; Tuesday has no entry whatsoever.
    const hours: BusinessHoursDay[] = [{ day: "monday", isClosed: false, open: "09:00", close: "17:00" }];
    // 2026-01-06 is a Tuesday.
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-06T12:00:00.000Z")).withinHours).toBe(false);
  });
});

describe("isWithinBusinessHours — ordinary same-day period, boundaries", () => {
  // 2026-01-05 is a Monday. UTC timezone keeps local == UTC, isolating the boundary logic itself
  // from any offset conversion.
  const hours = withDay("monday", "09:00", "17:00");

  it("1 minute before opening is closed", () => {
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-05T08:59:00.000Z")).withinHours).toBe(false);
  });
  it("exactly at opening is open", () => {
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-05T09:00:00.000Z")).withinHours).toBe(true);
  });
  it("during service is open", () => {
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-05T13:00:00.000Z")).withinHours).toBe(true);
  });
  it("exactly at closing is closed (close is exclusive)", () => {
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-05T17:00:00.000Z")).withinHours).toBe(false);
  });
  it("1 minute after closing is closed", () => {
    expect(isWithinBusinessHours(hours, "UTC", new Date("2026-01-05T17:01:00.000Z")).withinHours).toBe(false);
  });
});

describe("isWithinBusinessHours — closed days", () => {
  const mondayOnly = withDay("monday", "09:00", "17:00");

  it("an explicitly closed day is closed all day, even at a time that would be open on another day", () => {
    // 2026-01-06 is Tuesday — configured isClosed:true (via CLOSED base).
    expect(isWithinBusinessHours(mondayOnly, "UTC", new Date("2026-01-06T13:00:00.000Z")).withinHours).toBe(false);
  });
});

describe("isWithinBusinessHours — overnight periods (close < open wraps past midnight)", () => {
  // Monday 18:00-02:00, Asia/Karachi (UTC+5, fixed offset — isolates the wrap logic from DST).
  // 2026-01-05 is a Monday.
  const overnight = withDay("monday", "18:00", "02:00");

  it("17:00 Monday local (before opening) is closed", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T12:00:00.000Z")).withinHours).toBe(false);
  });
  it("19:00 Monday local (within the pre-midnight part) is open", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T14:00:00.000Z")).withinHours).toBe(true);
  });
  it("midnight (00:00 Tuesday local) is still open — the overnight tail", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T19:00:00.000Z")).withinHours).toBe(true);
  });
  it("01:00 Tuesday local is still open — Tuesday's OWN configured hours (closed) are irrelevant here", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T20:00:00.000Z")).withinHours).toBe(true);
  });
  it("exactly 02:00 Tuesday local is closed (close is exclusive)", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T21:00:00.000Z")).withinHours).toBe(false);
  });
  it("03:00 Tuesday local is closed", () => {
    expect(isWithinBusinessHours(overnight, "Asia/Karachi", new Date("2026-01-05T22:00:00.000Z")).withinHours).toBe(false);
  });
});

describe("isWithinBusinessHours — different restaurant timezones evaluate independently of server/UTC time", () => {
  const hours = withDay("monday", "09:00", "17:00");
  // The SAME UTC instant (2026-01-05T20:00:00.000Z = 20:00 UTC Monday) is 01:00 Tuesday in Karachi
  // (UTC+5, closed — Monday's hours ended at 17:00) but only 15:00 Monday in Chicago (UTC-6ish in
  // January, standard time — well within 09:00-17:00).
  it("Asia/Karachi: this instant is already Tuesday, closed", () => {
    expect(isWithinBusinessHours(hours, "Asia/Karachi", new Date("2026-01-05T20:00:00.000Z")).withinHours).toBe(false);
  });
  it("America/Chicago: the identical instant is Monday afternoon, open", () => {
    expect(isWithinBusinessHours(hours, "America/Chicago", new Date("2026-01-05T20:00:00.000Z")).withinHours).toBe(true);
  });
});

describe("isWithinBusinessHours — DST correctness (America/New_York)", () => {
  // Sunday 09:00-21:00. 2026's US spring-forward is 2026-03-08 (2am -> 3am), fall-back is
  // 2026-11-01 (2am -> 1am) — both independently confirmed against Node's own Intl data before
  // writing this fixture, not assumed.
  const sundayHours = withDay("sunday", "09:00", "21:00");

  it("spring-forward day: 08:59 local (EDT, already in effect by opening time) is closed", () => {
    expect(isWithinBusinessHours(sundayHours, "America/New_York", new Date("2026-03-08T12:59:00.000Z")).withinHours).toBe(false);
  });
  it("spring-forward day: exactly 09:00 local (13:00 UTC, EDT = UTC-4) is open", () => {
    expect(isWithinBusinessHours(sundayHours, "America/New_York", new Date("2026-03-08T13:00:00.000Z")).withinHours).toBe(true);
  });
  it("fall-back day: exactly 09:00 local (14:00 UTC, EST = UTC-5, already reverted by opening time) is open", () => {
    expect(isWithinBusinessHours(sundayHours, "America/New_York", new Date("2026-11-01T14:00:00.000Z")).withinHours).toBe(true);
  });
  it("does not behave as a permanently fixed UTC offset — the same local wall-clock hour needs a different UTC instant across the transition", () => {
    // 09:00 local pre-transition (EST, UTC-5) vs 09:00 local post-transition (EDT, UTC-4) on two
    // adjacent Sundays must map to DIFFERENT UTC-instant offsets from local midnight.
    const beforeChangeUtc = new Date("2026-03-01T14:00:00.000Z"); // Sunday, still EST (UTC-5)
    const afterChangeUtc = new Date("2026-03-08T13:00:00.000Z"); // Sunday, now EDT (UTC-4)
    expect(isWithinBusinessHours(sundayHours, "America/New_York", beforeChangeUtc).withinHours).toBe(true);
    expect(isWithinBusinessHours(sundayHours, "America/New_York", afterChangeUtc).withinHours).toBe(true);
  });
});

describe("getNextOpenAt", () => {
  it("returns null when businessHours is empty (no restriction, so no 'next open' to report)", () => {
    expect(getNextOpenAt([], "UTC", new Date("2026-01-05T12:00:00.000Z"))).toBeNull();
  });

  it("returns null when already within hours", () => {
    const hours = withDay("monday", "09:00", "17:00");
    expect(getNextOpenAt(hours, "UTC", new Date("2026-01-05T12:00:00.000Z"))).toBeNull();
  });

  it("opens later today", () => {
    const hours = withDay("monday", "09:00", "17:00");
    const next = getNextOpenAt(hours, "UTC", new Date("2026-01-05T07:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("opens tomorrow, when today is already past closing", () => {
    // Monday 09:00-17:00, Tuesday 09:00-17:00 too; asking at 18:00 Monday should find Tuesday 09:00.
    const hours = CLOSED.map((d) =>
      d.day === "monday" || d.day === "tuesday" ? { day: d.day, isClosed: false, open: "09:00", close: "17:00" } : d
    );
    const next = getNextOpenAt(hours, "UTC", new Date("2026-01-05T18:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-01-06T09:00:00.000Z");
  });

  it("skips over a fully closed day to find the next real opening", () => {
    // Only Wednesday configured open; asking on Monday should skip Tuesday (closed) and land Wednesday.
    const hours: BusinessHoursDay[] = [{ day: "wednesday", isClosed: false, open: "09:00", close: "17:00" }];
    const next = getNextOpenAt(hours, "UTC", new Date("2026-01-05T12:00:00.000Z")); // Monday
    expect(next?.toISOString()).toBe("2026-01-07T09:00:00.000Z"); // 2026-01-07 is Wednesday
  });

  it("correctly converts a future local opening time across a DST boundary (America/New_York)", () => {
    // Asking on Saturday 2026-03-07 (still EST) for the next Sunday 09:00 opening, which falls on
    // 2026-03-08 — the spring-forward day itself, so 09:00 local that day is already EDT (UTC-4),
    // not EST (UTC-5). A naive fixed-offset calculation would be off by an hour.
    const hours = withDay("sunday", "09:00", "21:00");
    const next = getNextOpenAt(hours, "America/New_York", new Date("2026-03-07T13:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("finds the start of an overnight period as the next opening", () => {
    const hours = withDay("monday", "18:00", "02:00");
    const next = getNextOpenAt(hours, "Asia/Karachi", new Date("2026-01-05T10:00:00.000Z")); // 15:00 Monday local
    expect(next?.toISOString()).toBe("2026-01-05T13:00:00.000Z"); // 18:00 Monday local = 13:00 UTC
  });
});
