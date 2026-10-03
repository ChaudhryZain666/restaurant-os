import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";
import { cleanupExpiredDemoData } from "./demoCleanup.service.js";

/** Phase 87 — the hourly `demo.cleanup_tick` job's logic (formerly only scripts/cleanupDemoData.ts). */
let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
const userIds: mongoose.Types.ObjectId[] = [];

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant();
});

afterAll(async () => {
  await Order.deleteMany({ restaurantId: restaurant._id });
  await User.deleteMany({ _id: { $in: userIds } });
  await Restaurant.deleteOne({ _id: restaurant._id });
  await closeTestConnections();
});

describe("cleanupExpiredDemoData", () => {
  it("removes expired demo accounts and their demo orders, and leaves everyone else alone", async () => {
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 3_600_000);
    const expired = await createTestUser("customer", undefined, { isDemoAccount: true, demoExpiresAt: past });
    const active = await createTestUser("customer", undefined, { isDemoAccount: true, demoExpiresAt: future });
    const real = await createTestUser("customer");
    userIds.push(expired._id, active._id, real._id);
    const expiredOrder = await createTestOrder(restaurant._id, expired._id, { isDemo: true });
    const activeOrder = await createTestOrder(restaurant._id, active._id, { isDemo: true });
    const realOrder = await createTestOrder(restaurant._id, real._id);

    const result = await cleanupExpiredDemoData();

    expect(result.users).toBeGreaterThanOrEqual(1);
    expect(await User.exists({ _id: expired._id })).toBeNull();
    expect(await Order.exists({ _id: expiredOrder._id })).toBeNull();
    expect(await User.exists({ _id: active._id })).not.toBeNull();
    expect(await Order.exists({ _id: activeOrder._id })).not.toBeNull();
    expect(await User.exists({ _id: real._id })).not.toBeNull();
    expect(await Order.exists({ _id: realOrder._id })).not.toBeNull();
  });

  it("is a no-op when nothing has expired", async () => {
    await User.deleteMany({ isDemoAccount: true, demoExpiresAt: { $lt: new Date() } });
    expect(await cleanupExpiredDemoData()).toEqual({ users: 0, orders: 0, payments: 0 });
  });
});
