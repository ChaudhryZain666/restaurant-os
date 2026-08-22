import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Counter } from "../models/Counter.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let menuItemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let ownerAToken: string;
let ownerBToken: string;
let staffAToken: string;
let customerToken: string;
let customerId: string;

async function placeOrder() {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ orderType: "pickup", items: [{ menuItemId: menuItemA.id, quantity: 2, selectedModifiers: [] }] });
  return res.body.data.order as { id: string; total: number };
}

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, deliveryEnabled: false, minOrderAmount: 0, taxRate: 0, deliveryFee: 0 },
  });
  restaurantB = await createTestRestaurant();
  const categoryA = await createTestCategory(restaurantA._id);
  menuItemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 10 });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const customer = await createTestUser("customer");
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);
  staffAToken = tokenFor(staffA);
  customerToken = tokenFor(customer);
  customerId = customer.id;

  const order1 = await placeOrder();
  const order2 = await placeOrder();
  const order3 = await placeOrder();
  const order4 = await placeOrder();

  // order1: paid, left "confirmed"
  await request(app)
    .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order1.id}/status`)
    .set("Authorization", `Bearer ${ownerAToken}`)
    .send({ status: "confirmed" });
  await request(app)
    .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order1.id}/payment-status`)
    .set("Authorization", `Bearer ${ownerAToken}`)
    .send({ paymentStatus: "paid" });

  // order2: paid, completed
  for (const status of ["confirmed", "preparing", "ready", "completed"]) {
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order2.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status });
  }
  await request(app)
    .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order2.id}/payment-status`)
    .set("Authorization", `Bearer ${ownerAToken}`)
    .send({ paymentStatus: "paid" });

  // order3: left pending, unpaid (counts toward orders, not revenue)
  void order3;

  // order4: cancelled, unpaid — excluded from revenue and topSellingItems
  await request(app)
    .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order4.id}/status`)
    .set("Authorization", `Bearer ${ownerAToken}`)
    .send({ status: "cancelled" });
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyAccount.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyTransaction.deleteMany({ restaurantId: { $in: ids } }),
    Counter.deleteMany({ _id: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

describe("restaurant analytics", () => {
  it("computes orders/revenue/completed/cancelled counts correctly, excluding unpaid and cancelled orders from revenue", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(200);
    const analytics = res.body.data.analytics;

    expect(analytics.ordersToday).toBe(4);
    expect(analytics.ordersThisWeek).toBe(4);
    expect(analytics.revenueToday).toBeCloseTo(40); // order1 + order2, $20 each (10 * 2 qty)
    expect(analytics.revenueThisWeek).toBeCloseTo(40);
    expect(analytics.averageOrderValue).toBeCloseTo(20);
    expect(analytics.completedOrdersThisWeek).toBe(1);
    expect(analytics.cancelledOrdersThisWeek).toBe(1);
  });

  it("excludes cancelled orders from top-selling items but counts confirmed/completed ones", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    const top = res.body.data.analytics.topSellingItems;
    const entry = top.find((i: { menuItemId: string }) => i.menuItemId === menuItemA.id);
    // 3 non-cancelled orders (order1, order2, order3) x quantity 2 each = 6; order4 (cancelled) excluded.
    expect(entry?.quantitySold).toBe(6);
  });

  it("restaurant B cannot see restaurant A's analytics", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant_staff (no restaurant.analytics.read permission) cannot view analytics", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });
});

describe("restaurant analytics — daily time series", () => {
  it("buckets today's orders correctly: cancelled orders excluded, revenue only from paid orders", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics/timeseries?days=7`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(200);
    const series = res.body.data.series as Array<{ date: string; orders: number; revenue: number }>;
    expect(series).toHaveLength(7);

    const today = new Date().toISOString().slice(0, 10);
    const todayPoint = series.find((p) => p.date === today);
    // order1 (paid, confirmed) + order2 (paid, completed) + order3 (pending, unpaid) all count as
    // orders; order4 (cancelled) does not. Revenue only from order1 + order2 ($20 each = $40).
    expect(todayPoint?.orders).toBe(3);
    expect(todayPoint?.revenue).toBeCloseTo(40);

    // Every day in range is present even with zero activity — a dense series, not a sparse one.
    const dates = series.map((p) => p.date);
    expect(new Set(dates).size).toBe(7);
  });

  it("rejects a days value outside the allowed set", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics/timeseries?days=45`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });

  it("restaurant B cannot see restaurant A's time series", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/analytics/timeseries?days=7`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});
