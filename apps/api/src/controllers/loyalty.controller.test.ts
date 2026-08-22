import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { LoyaltyAccount, LoyaltyTransaction } from "../models/LoyaltyAccount.js";
import { earnPoints } from "../services/loyalty.service.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let customer: Awaited<ReturnType<typeof createTestUser>>;
let customerToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  customer = await createTestUser("customer");
  customerToken = tokenFor(customer);

  // The same customer earns points at restaurant A only — restaurant B should show them as a
  // brand-new, zero-balance member, never a shared/global balance.
  await earnPoints(restaurantA.id, customer.id, "000000000000000000000000", 120);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    LoyaltyAccount.deleteMany({ restaurantId: { $in: ids } }),
    LoyaltyTransaction.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteOne({ _id: customer._id }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("loyalty isolation across restaurants (Phase 8, Part 14)", () => {
  it("the customer has a real, non-zero points balance at restaurant A", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/me`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.account.pointsBalance).toBe(120);
  });

  it("the SAME customer has a separate, zero balance at restaurant B — no cross-restaurant leakage", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantB.id}/loyalty/me`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.account.pointsBalance).toBe(0);
  });

  it("restaurant A's transaction history never includes anything scoped to restaurant B", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/me/history`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions.length).toBeGreaterThan(0);
    expect(res.body.data.transactions.every((t: { restaurantId: string }) => t.restaurantId === restaurantA.id)).toBe(
      true
    );
  });

  it("restaurant B's transaction history is empty for this customer", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantB.id}/loyalty/me/history`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toEqual([]);
  });
});
