import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import mongoose from "mongoose";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { closeTestConnections, createTestOrder, createTestRestaurant } from "../test-utils/fixtures.js";
import { getDailyTimeSeries, timezoneAwareDayStart } from "./analytics.service.js";

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

describe("getDailyTimeSeries across a daylight-saving change (calendar days, not 24h steps)", () => {
  const restaurantIds: mongoose.Types.ObjectId[] = [];
  afterAll(async () => {
    await Order.deleteMany({ restaurantId: { $in: restaurantIds } });
    await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  });

  async function orderAt(restaurantId: mongoose.Types.ObjectId, at: string) {
    const order = await createTestOrder(restaurantId, new mongoose.Types.ObjectId());
    // Set createdAt directly (bypassing Mongoose timestamps) to pin the order to a known instant.
    await Order.collection.updateOne({ _id: order._id }, { $set: { createdAt: new Date(at) } });
  }

  it("autumn (New York leaves DST on 2026-11-01): seven consecutive dates, and the last day keeps its orders", async () => {
    const restaurant = await createTestRestaurant({ settings: { currency: "USD", timezone: "America/New_York" } });
    restaurantIds.push(restaurant._id);
    await orderAt(restaurant._id, "2026-10-31T16:00:00.000Z"); // Oct 31, 12:00 EDT
    await orderAt(restaurant._id, "2026-11-06T20:00:00.000Z"); // Nov 6, 15:00 EST
    await orderAt(restaurant._id, "2026-11-06T20:10:00.000Z");

    const points = await getDailyTimeSeries(restaurant.id as string, new Date("2026-10-31T20:30:00.000Z"), new Date("2026-11-06T20:30:00.000Z"));
    expect(points.map((p) => p.date)).toEqual(["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(points.find((p) => p.date === "2026-11-06")?.orders).toBe(2);
    expect(points.find((p) => p.date === "2026-10-31")?.orders).toBe(1);
  });

  it("spring (New York enters DST on 2026-03-08): seven consecutive dates, no gap or duplicate", async () => {
    const restaurant = await createTestRestaurant({ settings: { currency: "USD", timezone: "America/New_York" } });
    restaurantIds.push(restaurant._id);
    await orderAt(restaurant._id, "2026-03-11T15:00:00.000Z"); // Mar 11, 11:00 EDT

    const points = await getDailyTimeSeries(restaurant.id as string, new Date("2026-03-05T15:00:00.000Z"), new Date("2026-03-11T15:30:00.000Z"));
    expect(points.map((p) => p.date)).toEqual(["2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11"]);
    expect(points.find((p) => p.date === "2026-03-11")?.orders).toBe(1);
  });
});
