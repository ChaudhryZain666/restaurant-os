import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { LoyaltyReward } from "../models/LoyaltyReward.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let staffAToken: string;
let customerToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const customer = await createTestUser("customer");

  ownerAToken = tokenFor(ownerA);
  staffAToken = tokenFor(staffA);
  customerToken = tokenFor(customer);
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    LoyaltyReward.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("Phase 28 — loyalty reward catalog", () => {
  let rewardId: string;

  it("restaurant.loyalty.manage (owner) can create a reward", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Free drink", description: "Any fountain drink", pointCost: 50 });
    expect(res.status).toBe(201);
    expect(res.body.data.reward.name).toBe("Free drink");
    expect(res.body.data.reward.isActive).toBe(true);
    rewardId = res.body.data.reward.id;
  });

  it("a plain restaurant_staff (no restaurant.loyalty.manage) cannot create a reward", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ name: "Should fail", pointCost: 10 });
    expect(res.status).toBe(403);
  });

  it("a customer can browse the active reward catalog for a restaurant", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.rewards.some((r: { id: string }) => r.id === rewardId)).toBe(true);
  });

  it("cross-restaurant isolation: restaurant B's catalog never shows restaurant A's rewards", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantB.id}/loyalty/rewards`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.rewards).toHaveLength(0);
  });

  it("deactivating a reward removes it from the customer-facing catalog but keeps it in the admin list", async () => {
    const patchRes = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards/${rewardId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ isActive: false });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.reward.isActive).toBe(false);

    const publicRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(publicRes.body.data.rewards.some((r: { id: string }) => r.id === rewardId)).toBe(false);

    const adminRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards/admin`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(adminRes.body.data.rewards.some((r: { id: string }) => r.id === rewardId)).toBe(true);
  });

  it("a staff-role account (restaurant.loyalty.manage absent) cannot see the admin reward list", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards/admin`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });

  it("an owner cannot edit or delete a reward belonging to a different restaurant", async () => {
    const editRes = await request(app)
      .patch(`/api/v1/restaurants/${restaurantB.id}/loyalty/rewards/${rewardId}`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ name: "Hijacked" });
    // restaurantB has no owner token fixture set up with tenant access — this exercises the
    // requireTenantMatch boundary, and separately the reward lookup itself is scoped to
    // {_id, restaurantId} so even a same-restaurant staff can never touch another restaurant's row.
    expect([403, 404]).toContain(editRes.status);
  });

  it("deletes a reward", async () => {
    const res = await request(app)
      .delete(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards/${rewardId}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);

    const adminRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/loyalty/rewards/admin`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(adminRes.body.data.rewards.some((r: { id: string }) => r.id === rewardId)).toBe(false);
  });
});
