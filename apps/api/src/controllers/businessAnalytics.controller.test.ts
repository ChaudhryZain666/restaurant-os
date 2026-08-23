import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { Business } from "../models/Business.js";
import { User } from "../models/User.js";
import { Counter } from "../models/Counter.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let locationUsd: Awaited<ReturnType<typeof createTestRestaurant>>; // America/New_York, USD
let locationGbp: Awaited<ReturnType<typeof createTestRestaurant>>; // Asia/Karachi, GBP
let locationEmpty: Awaited<ReturnType<typeof createTestRestaurant>>; // same business, zero orders
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let otherLocation: Awaited<ReturnType<typeof createTestRestaurant>>;
let menuItemUsd: Awaited<ReturnType<typeof createTestMenuItem>>;
let menuItemGbp: Awaited<ReturnType<typeof createTestMenuItem>>;

let ownerToken: string;
let managerToken: string;
let staffToken: string;
let crossBusinessOwnerToken: string;
let platformAdminToken: string;
let customerToken: string;
let customerId: string;

async function placeAndPay(restaurantId: string, menuItemId: string, customerAuth: string, ownerAuth: string) {
  const orderRes = await request(app)
    .post(`/api/v1/restaurants/${restaurantId}/orders`)
    .set("Authorization", `Bearer ${customerAuth}`)
    .send({ orderType: "pickup", items: [{ menuItemId, quantity: 1, selectedModifiers: [] }] });
  const order = orderRes.body.data.order as { id: string };
  await request(app)
    .patch(`/api/v1/restaurants/${restaurantId}/orders/${order.id}/payment-status`)
    .set("Authorization", `Bearer ${ownerAuth}`)
    .send({ paymentStatus: "paid" });
  return order;
}

beforeAll(async () => {
  await connectDB();

  business = await createTestBusiness();
  locationUsd = await createTestRestaurant({
    businessId: business._id,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      minOrderAmount: 0,
      taxRate: 0,
      deliveryFee: 0,
      currency: "USD",
      timezone: "America/New_York",
    },
  });
  locationGbp = await createTestRestaurant({
    businessId: business._id,
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      minOrderAmount: 0,
      taxRate: 0,
      deliveryFee: 0,
      currency: "GBP",
      timezone: "Asia/Karachi",
    },
  });
  locationEmpty = await createTestRestaurant({ businessId: business._id, settings: { currency: "USD", timezone: "UTC" } });
  otherBusiness = await createTestBusiness();
  otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });

  const categoryUsd = await createTestCategory(locationUsd._id);
  menuItemUsd = await createTestMenuItem(locationUsd._id, categoryUsd._id, { price: 10 });
  const categoryGbp = await createTestCategory(locationGbp._id);
  menuItemGbp = await createTestMenuItem(locationGbp._id, categoryGbp._id, { price: 20 });

  const owner = await createTestUser("restaurant_owner", locationUsd._id, { businessId: business._id });
  const manager = await createTestUser("restaurant_manager", locationUsd._id, { businessId: business._id });
  const staff = await createTestUser("restaurant_staff", locationUsd._id, {
    businessId: business._id,
    locationIds: [locationUsd._id],
  });
  const crossBusinessOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
  const platformAdmin = await createTestUser("platform_admin");
  const customer = await createTestUser("customer");

  ownerToken = tokenFor(owner);
  managerToken = tokenFor(manager);
  staffToken = tokenFor(staff);
  crossBusinessOwnerToken = tokenFor(crossBusinessOwner);
  platformAdminToken = tokenFor(platformAdmin);
  customerToken = tokenFor(customer);
  customerId = customer.id as string;

  // Two paid $10 orders at the USD location, one paid £20 order at the GBP location.
  await placeAndPay(locationUsd.id, menuItemUsd.id, customerToken, ownerToken);
  await placeAndPay(locationUsd.id, menuItemUsd.id, customerToken, ownerToken);
  await placeAndPay(locationGbp.id, menuItemGbp.id, customerToken, ownerToken);
});

afterAll(async () => {
  const businessIds = [business._id, otherBusiness._id];
  const restaurantIds = [locationUsd._id, locationGbp._id, locationEmpty._id, otherLocation._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    MenuItem.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Category.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Counter.deleteMany({ _id: { $in: restaurantIds } }),
    User.deleteMany({ businessId: { $in: businessIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteOne({ _id: customerId }),
  ]);
  await closeTestConnections();
});

describe("GET /businesses/:businessId/analytics/overview", () => {
  it("groups revenue by currency rather than summing across currencies", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);

    const { overview } = res.body.data;
    expect(overview.totalOrders).toBe(3); // currency-agnostic, safely combined

    const usd = overview.revenueByCurrency.find((c: { currency: string }) => c.currency === "USD");
    const gbp = overview.revenueByCurrency.find((c: { currency: string }) => c.currency === "GBP");
    expect(usd.amount).toBeCloseTo(20); // 2 x $10
    expect(gbp.amount).toBeCloseTo(20); // 1 x £20
    // Never a single blended "40" — two separate currency entries, never merged into one number.
    expect(overview.revenueByCurrency).toHaveLength(2);
  });

  it("breaks revenue down per location, including a zero-order location", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const { byLocation } = res.body.data.overview;

    const usdRow = byLocation.find((l: { locationId: string }) => l.locationId === locationUsd.id);
    const emptyRow = byLocation.find((l: { locationId: string }) => l.locationId === locationEmpty.id);
    expect(usdRow.orders).toBe(2);
    expect(usdRow.revenue).toBeCloseTo(20);
    expect(usdRow.currency).toBe("USD");
    expect(emptyRow.orders).toBe(0);
    expect(emptyRow.revenue).toBe(0);
  });

  it("computes average order value per currency as a true weighted average, not an average of averages", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const { averageOrderValueByCurrency } = res.body.data.overview;
    const usd = averageOrderValueByCurrency.find((c: { currency: string }) => c.currency === "USD");
    expect(usd.amount).toBeCloseTo(10); // $20 revenue / 2 paid orders
  });

  it.each([
    ["manager", 200, () => managerToken],
    ["staff", 403, () => staffToken],
    ["cross-business owner", 403, () => crossBusinessOwnerToken],
    ["platform_admin", 403, () => platformAdminToken],
  ])("%s -> expected status %d", async (_label, expectedStatus, getToken) => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview`)
      .set("Authorization", `Bearer ${getToken()}`);
    expect(res.status).toBe(expectedStatus);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/v1/businesses/${business.id}/analytics/overview`);
    expect(res.status).toBe(401);
  });

  it("silently drops a locationIds filter entry that belongs to a different business, rather than leaking its data", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview?locationIds=${locationUsd.id},${otherLocation.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const { byLocation } = res.body.data.overview;
    expect(byLocation).toHaveLength(1);
    expect(byLocation[0].locationId).toBe(locationUsd.id);
  });

  it("narrows correctly to a single valid location", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview?locationIds=${locationGbp.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const { overview } = res.body.data;
    expect(overview.totalOrders).toBe(1);
    expect(overview.revenueByCurrency).toHaveLength(1);
    expect(overview.revenueByCurrency[0].currency).toBe("GBP");
    expect(overview.revenueByCurrency[0].amount).toBeCloseTo(20);
  });

  it("rejects a date range exceeding the maximum", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/overview?from=2020-01-01&to=2020-12-31`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /businesses/:businessId/analytics/trends", () => {
  it("returns a currency-grouped daily series that includes today's activity", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/trends`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const { points } = res.body.data.trends;
    const totalOrders = points.reduce((sum: number, p: { orders: number }) => sum + p.orders, 0);
    expect(totalOrders).toBe(3);
  });

  it("cross-business owner cannot see this business's trends", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/trends`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /businesses/:businessId/analytics/products", () => {
  it("returns business-wide top-selling items across locations", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/analytics/products`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const items = res.body.data.products.items as Array<{ menuItemId: string; quantitySold: number }>;
    const usdItem = items.find((i) => i.menuItemId === menuItemUsd.id);
    expect(usdItem?.quantitySold).toBe(2);
  });
});
