import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerA: Awaited<ReturnType<typeof createTestUser>>;
let ownerAToken: string;
let ownerBToken: string;
let staffToken: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const staff = await createTestUser("restaurant_staff", restaurantA._id);
  ownerAToken = tokenFor(ownerA);
  ownerBToken = tokenFor(ownerB);
  staffToken = tokenFor(staff);

  const orderTargetId = "6a0000000000000000000001";
  const paymentTargetId = "6a0000000000000000000002";
  for (let i = 0; i < 3; i++) {
    await AuditLog.create({
      restaurantId: restaurantA._id,
      actorUserId: ownerA._id,
      actorRole: "restaurant_owner",
      action: "order.status_changed",
      targetType: "order",
      targetId: orderTargetId,
      metadata: { from: "pending", to: "confirmed" },
    });
  }
  await AuditLog.create({
    restaurantId: restaurantA._id,
    actorUserId: ownerA._id,
    actorRole: "restaurant_owner",
    action: "payment.refunded",
    targetType: "payment",
    targetId: paymentTargetId,
    metadata: { amount: 12.5 },
  });
  // A different restaurant's log entry — must never leak into restaurant A's view.
  await AuditLog.create({
    restaurantId: restaurantB._id,
    actorUserId: ownerB._id,
    actorRole: "restaurant_owner",
    action: "order.cancelled",
    targetType: "order",
    targetId: orderTargetId,
  });
});

afterAll(async () => {
  await AuditLog.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } });
  await Restaurant.deleteMany({ _id: { $in: [restaurantA._id, restaurantB._id] } });
  await User.deleteMany({ restaurantId: { $in: [restaurantA._id, restaurantB._id] } });
  await closeTestConnections();
});

describe("GET /restaurants/:id/audit-log", () => {
  it("is paginated and resolves the actor's current name", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?limit=2`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.totalPages).toBe(2);
    expect(res.body.data.items[0].actorName).toBe(ownerA.name);
  });

  it("filters by targetType", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?targetType=payment`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].action).toBe("payment.refunded");
  });

  it("filters by action", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?action=order.status_changed`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(3);
  });

  it("rejects an un-whitelisted action value", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?action=not.a.real.action`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });

  it("never returns another restaurant's entries", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.body.data.items.every((e: { restaurantId: string }) => e.restaurantId === restaurantA.id)).toBe(true);
  });

  it("restaurant_staff (no restaurant.audit.read) cannot view the audit log", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("a different restaurant's owner cannot view this restaurant's audit log", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("filters by actorUserId", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?actorUserId=${ownerA.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.items.every((e: { actorUserId: string }) => e.actorUserId === ownerA.id)).toBe(true);
  });

  it("returns nothing for an actorUserId with no entries", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?actorUserId=000000000000000000000000`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  it("filters by a startDate/endDate range covering today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?startDate=${today}&endDate=${today}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(4);
  });

  it("returns nothing for a date range entirely in the past", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?startDate=2020-01-01&endDate=2020-01-02`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(0);
  });

  it("rejects a malformed date", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?startDate=not-a-date`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(400);
  });
});
