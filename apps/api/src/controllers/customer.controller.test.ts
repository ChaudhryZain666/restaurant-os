import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let ownerBToken: string;
let alice: Awaited<ReturnType<typeof createTestUser>>;
let bob: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);

  alice = await createTestUser("customer", undefined, { name: "Alice Anders", email: `alice-${Date.now()}@test.local` });
  bob = await createTestUser("customer", undefined, { name: "Bob Baker", email: `bob-${Date.now()}@test.local` });

  // Alice: 2 orders at restaurant A, one paid ($20) one unpaid ($15) — avg should be 20, not 17.5.
  await createTestOrder(restaurantA._id, alice._id, { total: 20, paymentStatus: "paid", createdAt: new Date(Date.now() - 1000) });
  await createTestOrder(restaurantA._id, alice._id, { total: 15, paymentStatus: "unpaid", createdAt: new Date() });
  // Bob: 1 paid order at restaurant A.
  await createTestOrder(restaurantA._id, bob._id, { total: 50, paymentStatus: "paid" });
  // Alice also ordered from restaurant B — must never appear in restaurant A's or B-vs-A leak.
  await createTestOrder(restaurantB._id, alice._id, { total: 99, paymentStatus: "paid" });
});

afterAll(async () => {
  await Order.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } });
  await Restaurant.deleteMany({ _id: { $in: [restaurantA._id, restaurantB._id] } });
  await User.deleteMany({ _id: { $in: [alice._id, bob._id] } });
  await closeTestConnections();
});

describe("GET /restaurants/:id/customers", () => {
  it("summarizes each customer's orders for this restaurant only, with avg computed over PAID orders", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers?sort=name&order=asc`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2);

    const aliceSummary = res.body.data.items.find((c: { name: string }) => c.name === "Alice Anders");
    expect(aliceSummary.totalOrders).toBe(2);
    expect(aliceSummary.totalSpent).toBe(20); // only the paid order counts
    expect(aliceSummary.avgOrderValue).toBe(20); // 20 / 1 paid order, not 35/2

    const bobSummary = res.body.data.items.find((c: { name: string }) => c.name === "Bob Baker");
    expect(bobSummary.totalOrders).toBe(1);
    expect(bobSummary.totalSpent).toBe(50);
  });

  it("never includes a customer's orders placed at a different restaurant", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers?sort=name&order=asc`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const aliceSummary = res.body.data.items.find((c: { name: string }) => c.name === "Alice Anders");
    expect(aliceSummary.totalSpent).toBe(20); // not 20 + 99 from restaurant B
    expect(aliceSummary.totalOrders).toBe(2); // not 3
  });

  it("a different restaurant's owner cannot list this restaurant's customers", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("search filters by customer name or email", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers?search=alice`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].name).toBe("Alice Anders");
  });

  it("rejects an un-whitelisted sort field", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers?sort=totalSpent$where`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });

  it("rejects an out-of-range limit", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers?limit=1000`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });
});

describe("GET /restaurants/:id/customers/:customerId/orders", () => {
  it("returns only this customer's orders at this restaurant, newest first", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers/${alice.id}/orders`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(2); // not the 3rd order Alice placed at restaurant B
    expect(res.body.data.items.every((o: { total: number }) => [20, 15].includes(o.total))).toBe(true);
    // Newest first: the $15 unpaid order was created after the $20 paid one.
    expect(res.body.data.items[0].total).toBe(15);
  });

  it("never includes another customer's orders", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers/${alice.id}/orders`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.body.data.items.every((o: { total: number }) => o.total !== 50)).toBe(true); // Bob's order
  });

  it("a different restaurant's owner cannot view this customer's orders here", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers/${alice.id}/orders`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("paginates with the shared page/limit convention", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/customers/${alice.id}/orders?page=1&limit=1`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.hasNextPage).toBe(true);
  });
});
