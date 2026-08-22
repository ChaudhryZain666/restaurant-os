import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { timezoneAwareDayStart } from "./analytics.service.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
});

describe("timezoneAwareDayStart (Phase 16 — restaurant-local 'today' boundary)", () => {
  it("for UTC, matches the plain UTC calendar-day boundary", async () => {
    const start = await timezoneAwareDayStart(new Date("2026-03-15T10:00:00.000Z"), "UTC");
    expect(start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("for a timezone ahead of UTC with no DST (Asia/Karachi, UTC+5), local midnight is the previous UTC calendar day", async () => {
    const start = await timezoneAwareDayStart(new Date("2026-03-15T10:00:00.000Z"), "Asia/Karachi");
    expect(start.toISOString()).toBe("2026-03-14T19:00:00.000Z");
  });

  it("for a timezone behind UTC (America/New_York), local midnight is later the same UTC calendar day", async () => {
    // 2026-03-15 is after America/New_York's spring-forward DST transition (2026-03-08), so it's
    // already UTC-4 (EDT).
    const start = await timezoneAwareDayStart(new Date("2026-03-15T10:00:00.000Z"), "America/New_York");
    expect(start.toISOString()).toBe("2026-03-15T04:00:00.000Z");
  });

  it("correctly reclassifies an order that's 'yesterday' in UTC but 'today' in a UTC+5 restaurant's timezone", async () => {
    // 2026-03-14T20:00:00Z is 2026-03-15T01:00:00 in Asia/Karachi (UTC+5) — after that restaurant's
    // local midnight, so it must fall on-or-after the "today" boundary even though it's still
    // "yesterday" by UTC's calendar. This is exactly the case a UTC-only boundary gets wrong.
    const order = new Date("2026-03-14T20:00:00.000Z");
    const todayStart = await timezoneAwareDayStart(new Date("2026-03-15T10:00:00.000Z"), "Asia/Karachi");
    expect(order.getTime()).toBeGreaterThanOrEqual(todayStart.getTime());
  });
});
