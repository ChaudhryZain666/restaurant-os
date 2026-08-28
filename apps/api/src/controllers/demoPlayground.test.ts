import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getRestaurantAnalytics } from "../services/analytics.service.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestOrder,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

/**
 * Phase 32 — the public storefront-playground demo: an ephemeral, credential-less session
 * (POST /auth/demo-session) that can place a real order through the real pipeline, flagged
 * server-side so it never appears in a restaurant's real staff-facing order list or analytics.
 */
const app = createApp();

let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let category: Awaited<ReturnType<typeof createTestCategory>>;
let menuItem: Awaited<ReturnType<typeof createTestMenuItem>>;
let ownerToken: string;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant({
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      deliveryEnabled: false,
      cashEnabled: true,
      onlinePaymentEnabled: false,
      minOrderAmount: 0,
      taxRate: 0,
      deliveryFee: 0,
    },
  });
  category = await createTestCategory(restaurant._id);
  menuItem = await createTestMenuItem(restaurant._id, category._id, { price: 10 });
  const owner = await createTestUser("restaurant_owner", restaurant._id);
  ownerToken = tokenFor(owner);
});

afterAll(async () => {
  await Order.deleteMany({ restaurantId: restaurant._id });
  await MenuItem.deleteMany({ restaurantId: restaurant._id });
  await Category.deleteMany({ restaurantId: restaurant._id });
  await User.deleteMany({ restaurantId: restaurant._id });
  await Restaurant.deleteOne({ _id: restaurant._id });
  await closeTestConnections();
});

describe("POST /auth/demo-session", () => {
  it("mints a throwaway, isDemoAccount:true session — same {user,accessToken} shape as login/register", async () => {
    const res = await request(app).post("/api/v1/auth/demo-session");

    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user.isDemoAccount).toBe(true);
    expect(res.body.data.user.role).toBe("customer");
    // Same refresh-cookie mechanism login()/register() use — the demo session behaves like a real
    // one for everything downstream (placeOrder(), etc.) without any special-casing.
    expect(res.headers["set-cookie"]?.[0]).toMatch(/^refreshToken=/);

    const stored = await User.findById(res.body.data.user.id);
    expect(stored!.isDemoAccount).toBe(true);
    expect(stored!.demoExpiresAt).toBeInstanceOf(Date);
  });
});

describe("demo orders are flagged server-side and hidden from real staff-facing views", () => {
  it("an order placed by a demo session is stored with isDemo:true, even if the client sends isDemo:false", async () => {
    const demoSession = await request(app).post("/api/v1/auth/demo-session");
    const demoToken = demoSession.body.data.accessToken as string;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set("Authorization", `Bearer ${demoToken}`)
      .send({
        orderType: "pickup",
        paymentMethod: "cash",
        // Not a field createOrderSchema accepts at all — proves the server never trusts this from
        // the client, only ever derives it from the authenticated session (isDemoAccount claim).
        isDemo: false,
        items: [{ menuItemId: menuItem.id, quantity: 1, selectedModifiers: [] }],
      });

    expect(res.status).toBe(201);
    const stored = await Order.findById(res.body.data.order.id);
    expect(stored!.isDemo).toBe(true);
  });

  it("a real customer's order is stored with isDemo:false", async () => {
    const customer = await createTestUser("customer");
    const customerToken = tokenFor(customer);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ orderType: "pickup", paymentMethod: "cash", items: [{ menuItemId: menuItem.id, quantity: 1, selectedModifiers: [] }] });

    expect(res.status).toBe(201);
    const stored = await Order.findById(res.body.data.order.id);
    expect(stored!.isDemo).toBe(false);
    await User.deleteOne({ _id: customer.id });
  });

  it("GET /restaurants/:id/orders (staff-facing — backs both KDS and Orders Management) excludes demo orders by default", async () => {
    const demoSession = await request(app).post("/api/v1/auth/demo-session");
    const demoOrderRes = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set("Authorization", `Bearer ${demoSession.body.data.accessToken}`)
      .send({ orderType: "pickup", paymentMethod: "cash", items: [{ menuItemId: menuItem.id, quantity: 1, selectedModifiers: [] }] });

    const customer = await createTestUser("customer");
    const realOrderRes = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders`)
      .set("Authorization", `Bearer ${tokenFor(customer)}`)
      .send({ orderType: "pickup", paymentMethod: "cash", items: [{ menuItemId: menuItem.id, quantity: 1, selectedModifiers: [] }] });

    const list = await request(app).get(`/api/v1/restaurants/${restaurant.id}/orders`).set("Authorization", `Bearer ${ownerToken}`);

    expect(list.status).toBe(200);
    const ids: string[] = list.body.data.orders.map((o: { id: string }) => o.id);
    expect(ids).toContain(realOrderRes.body.data.order.id);
    expect(ids).not.toContain(demoOrderRes.body.data.order.id);

    await User.deleteOne({ _id: customer.id });
  });

  it("analytics (getRestaurantAnalytics) excludes demo orders from ordersThisWeek", async () => {
    const before = await getRestaurantAnalytics(restaurant.id);

    const demoUser = await createTestUser("customer", undefined, { isDemoAccount: true });
    await createTestOrder(restaurant._id, demoUser._id, { isDemo: true });
    const realCustomer = await createTestUser("customer");
    await createTestOrder(restaurant._id, realCustomer._id, { isDemo: false });

    const after = await getRestaurantAnalytics(restaurant.id);

    expect(after.ordersThisWeek).toBe(before.ordersThisWeek + 1);

    await User.deleteMany({ _id: { $in: [demoUser._id, realCustomer._id] } });
  });
});
