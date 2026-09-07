import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { createTestOrder, createTestRestaurant, createTestUser, closeTestConnections } from "../test-utils/fixtures.js";
import { assertSafeToRun, runE2eOrderCleanup } from "./e2eOrderCleanup.service.js";

describe("assertSafeToRun (Phase 55)", () => {
  it("throws when NODE_ENV is production", () => {
    expect(() => assertSafeToRun("production")).toThrow(/production/);
  });

  it("does not throw for development or test", () => {
    expect(() => assertSafeToRun("development")).not.toThrow();
    expect(() => assertSafeToRun("test")).not.toThrow();
  });
});

describe("runE2eOrderCleanup (Phase 55)", () => {
  let e2eRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let realRestaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
  let e2eCustomer: Awaited<ReturnType<typeof createTestUser>>;
  let realCustomer: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await connectDB();
    e2eRestaurant = await createTestRestaurant({ slug: `e2e-cleanup-test-${Date.now()}` });
    realRestaurant = await createTestRestaurant({ slug: `real-restaurant-${Date.now()}` });
    e2eCustomer = await createTestUser("customer", undefined, { email: `e2e-cleanup-${Date.now()}@test.local` });
    realCustomer = await createTestUser("customer", undefined, { email: `real-customer-${Date.now()}@example.com` });
  });

  afterAll(async () => {
    await Order.deleteMany({ restaurantId: { $in: [e2eRestaurant._id, realRestaurant._id] } });
    await Restaurant.deleteMany({ _id: { $in: [e2eRestaurant._id, realRestaurant._id] } });
    await User.deleteMany({ _id: { $in: [e2eCustomer._id, realCustomer._id] } });
    await closeTestConnections();
  });

  it("deletes an old order against an e2e-slug restaurant, but not a real one", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const orderOnE2eRestaurant = await createTestOrder(e2eRestaurant._id, realCustomer._id, {
      orderNumber: `ORD-CLEAN-A-${Date.now()}`,
      createdAt: old,
    });
    const orderOnRealRestaurant = await createTestOrder(realRestaurant._id, realCustomer._id, {
      orderNumber: `ORD-CLEAN-B-${Date.now()}`,
      createdAt: old,
    });

    const result = await runE2eOrderCleanup();
    expect(result.deletedCount).toBeGreaterThanOrEqual(1);

    expect(await Order.findById(orderOnE2eRestaurant._id)).toBeNull();
    expect(await Order.findById(orderOnRealRestaurant._id)).not.toBeNull();

    await Order.deleteOne({ _id: orderOnRealRestaurant._id });
  });

  it("deletes an old order from an @test.local customer even against a non-e2e restaurant, but not a real customer's order", async () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const orderFromTestCustomer = await createTestOrder(realRestaurant._id, e2eCustomer._id, {
      orderNumber: `ORD-CLEAN-C-${Date.now()}`,
      createdAt: old,
    });
    const orderFromRealCustomer = await createTestOrder(realRestaurant._id, realCustomer._id, {
      orderNumber: `ORD-CLEAN-D-${Date.now()}`,
      createdAt: old,
    });

    await runE2eOrderCleanup();

    expect(await Order.findById(orderFromTestCustomer._id)).toBeNull();
    expect(await Order.findById(orderFromRealCustomer._id)).not.toBeNull();

    await Order.deleteOne({ _id: orderFromRealCustomer._id });
  });

  it("never deletes an order younger than the minimum age, even if every marker matches", async () => {
    const justCreated = await createTestOrder(e2eRestaurant._id, e2eCustomer._id, {
      orderNumber: `ORD-CLEAN-E-${Date.now()}`,
      createdAt: new Date(),
    });

    await runE2eOrderCleanup();

    expect(await Order.findById(justCreated._id)).not.toBeNull();
    await Order.deleteOne({ _id: justCreated._id });
  });

  it("is idempotent — a second run against an already-clean state deletes nothing", async () => {
    const first = await runE2eOrderCleanup();
    const second = await runE2eOrderCleanup();
    expect(second.deletedCount).toBe(0);
    expect(first.deletedCount).toBeGreaterThanOrEqual(0);
  });

  it("never touches the restaurant or user documents themselves", async () => {
    await runE2eOrderCleanup();
    expect(await Restaurant.findById(e2eRestaurant._id)).not.toBeNull();
    expect(await User.findById(e2eCustomer._id)).not.toBeNull();
  });
});
