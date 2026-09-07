import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { closeTestConnections, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";
import { LoyaltyAccount } from "../models/LoyaltyAccount.js";
import { ensureAllIndexes, findDuplicates } from "./indexMaintenance.service.js";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await closeTestConnections();
}, 20_000);

describe("ensureAllIndexes (Phase 49)", () => {
  it("is idempotent — running it twice in a row never throws", async () => {
    await expect(ensureAllIndexes()).resolves.toBeDefined();
    await expect(ensureAllIndexes()).resolves.toBeDefined();
  }, 30_000);

  it("processes every registered model", async () => {
    const { modelsProcessed } = await ensureAllIndexes();
    expect(modelsProcessed).toEqual(expect.arrayContaining(["User", "Order", "Payment", "LoyaltyTransaction"]));
    expect(modelsProcessed.length).toBeGreaterThanOrEqual(30);
  }, 30_000);

  it("leaves the new LoyaltyTransaction compound indexes in place and the old single-field ones gone", async () => {
    await ensureAllIndexes();
    const indexes = await mongoose.connection.db!.collection("loyaltytransactions").indexes();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("restaurantId_1_customerId_1_createdAt_-1");
    expect(names).toContain("restaurantId_1_type_1");
    expect(names).toContain("restaurantId_1_createdAt_-1");
    expect(names).not.toContain("restaurantId_1");
    expect(names).not.toContain("customerId_1");
  }, 30_000);

  it("leaves the new Payment {status,createdAt} index in place and the old single-field one gone", async () => {
    await ensureAllIndexes();
    const indexes = await mongoose.connection.db!.collection("payments").indexes();
    const names = indexes.map((i) => i.name);
    expect(names).toContain("status_1_createdAt_1");
    expect(names).not.toContain("status_1");
  }, 30_000);

  it("reports an already-retired index as such on a second run rather than erroring", async () => {
    await ensureAllIndexes();
    const { retired } = await ensureAllIndexes();
    const loyaltyRestaurantIdEntry = retired.find((r) => r.collection === "loyaltytransactions" && r.indexName === "restaurantId_1");
    expect(loyaltyRestaurantIdEntry?.reason).toBe("already-gone");
  }, 30_000);
});

describe("findDuplicates (Phase 49)", () => {
  it("reports no violations against the current (clean) dataset", async () => {
    const results = await findDuplicates();
    for (const r of results) {
      expect(r.violations).toEqual([]);
    }
  }, 20_000);

  it("actually detects a real duplicate when one exists — proves the check isn't a no-op", async () => {
    // LoyaltyAccount.{restaurantId,customerId} is DB-enforced unique, so a normal insert can't
    // create this violation — the whole point of this test is to prove findDuplicates() would
    // catch it if the constraint were ever violated (e.g. an index missing in a real deployment),
    // not just that it trivially reports nothing when the DB already prevents the problem.
    const restaurant = await createTestRestaurant();
    const customer = await createTestUser("customer");
    try {
      await LoyaltyAccount.collection.dropIndex("restaurantId_1_customerId_1");
      await LoyaltyAccount.collection.insertMany(
        [
          { restaurantId: restaurant._id, customerId: customer._id, pointsBalance: 0, tier: "bronze" },
          { restaurantId: restaurant._id, customerId: customer._id, pointsBalance: 0, tier: "bronze" },
        ],
        { ordered: false }
      );

      const results = await findDuplicates();
      const loyaltyResult = results.find((r) => r.label.startsWith("LoyaltyAccount"));
      expect(loyaltyResult?.violations).toHaveLength(1);
      expect(loyaltyResult?.violations[0].count).toBe(2);
    } finally {
      await LoyaltyAccount.deleteMany({ restaurantId: restaurant._id, customerId: customer._id });
      await LoyaltyAccount.collection.createIndex({ restaurantId: 1, customerId: 1 }, { unique: true });
      const { Restaurant } = await import("../models/Restaurant.js");
      const { User } = await import("../models/User.js");
      await Restaurant.deleteOne({ _id: restaurant._id });
      await User.deleteOne({ _id: customer._id });
    }
  }, 20_000);
});
