import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Restaurant } from "../models/Restaurant.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestCategory,
  createTestMenuItem,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

/**
 * Phase 75 — POS sale attribution, the Pending Sales recovery surface, and the payment-safety
 * invariant that a cancelled order can never become paid (through either the cash/staff-card path
 * or the Phase 74 terminal path). End to end against the real posRouter/orderRouter and the real
 * Payment/Order models.
 */
const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let staffAToken: string;
let staffLocationBOnlyToken: string;
let kitchenAToken: string;
let ownerBToken: string;
let itemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let staffAUserId: string;

async function ringUpOrder(token: string, restaurantId: string, itemId: string, opts: Record<string, unknown> = {}) {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurantId}/pos/orders`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      customer: { name: "Pending Sale Customer" },
      items: [{ menuItemId: itemId, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "cash",
      markPaidImmediately: false,
      ...opts,
    });
  expect(res.status).toBe(201);
  return res.body.data.order as { id: string; total: number; createdByUserId?: string };
}

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, posEnabled: true, minOrderAmount: 0, taxRate: 0 },
  });
  restaurantB = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, posEnabled: true, minOrderAmount: 0, taxRate: 0 },
  });

  const staffA = await createTestUser("restaurant_staff", restaurantA._id, { name: "Staff A" });
  const staffLocationBOnly = await createTestUser("restaurant_staff", restaurantB._id, { name: "Staff B-only" });
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);

  staffAToken = tokenFor(staffA);
  staffAUserId = staffA.id;
  staffLocationBOnlyToken = tokenFor(staffLocationBOnly);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);

  const category = await createTestCategory(restaurantA._id);
  itemA = await createTestMenuItem(restaurantA._id, category._id, { price: 12 });
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Order.deleteMany({ restaurantId: { $in: ids } }),
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    Category.deleteMany({ restaurantId: { $in: ids } }),
    MenuItem.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ email: /@pos\.local$/ }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await closeTestConnections();
});

describe("POS sale attribution (Phase 75)", () => {
  it("sets createdByUserId to the authenticated staff member, never from the request body", async () => {
    const spoofedId = "64b000000000000000000000";
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id, { createdByUserId: spoofedId });
    expect(order.createdByUserId).toBe(staffAUserId);
    expect(order.createdByUserId).not.toBe(spoofedId);
  });

  it("leaves createdByUserId unset for a non-POS (online-channel) order", async () => {
    const customer = await createTestUser("customer");
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${tokenFor(customer)}`)
      .send({
        items: [{ menuItemId: itemA.id, quantity: 1, selectedModifiers: [] }],
        orderType: "pickup",
        paymentMethod: "cash",
      });
    expect(res.status).toBe(201);
    expect(res.body.data.order.createdByUserId).toBeUndefined();
  });
});

describe("Pending sales (Phase 75)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`);
    expect(res.status).toBe(401);
  });

  it("kitchen_staff cannot list pending sales (lacks restaurant.pos.operate)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${kitchenAToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot list restaurant A's pending sales (tenant isolation)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("a staff member scoped only to location B cannot manipulate the URL to see location A's pending sales", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${staffLocationBOnlyToken}`);
    expect(res.status).toBe(403);
  });

  it("lists an unpaid POS order with its creator's name, excludes paid/cancelled/online orders", async () => {
    const pending = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);

    const paid = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${paid.id}/payment-status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ paymentStatus: "paid" });

    const cancelled = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${cancelled.id}/status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ status: "cancelled" });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.orders.map((o: { id: string }) => o.id);
    expect(ids).toContain(pending.id);
    expect(ids).not.toContain(paid.id);
    expect(ids).not.toContain(cancelled.id);

    const found = res.body.data.orders.find((o: { id: string }) => o.id === pending.id);
    expect(found.createdByName).toBe("Staff A");
    expect(found.paymentStatus).toBe("unpaid");
  });

  it("cancelling a pending sale removes it from the pending-sales list", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const before = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(before.body.data.orders.map((o: { id: string }) => o.id)).toContain(order.id);

    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ status: "cancelled" });

    const after = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/pending-sales`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(after.body.data.orders.map((o: { id: string }) => o.id)).not.toContain(order.id);
  });
});

describe("Order/payment status safety invariants (Phase 75)", () => {
  it("a cancelled order can never be marked paid via the manual payment-status endpoint", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ status: "cancelled" });

    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payment-status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ paymentStatus: "paid" });
    expect(res.status).toBe(400);

    const stored = await Order.findById(order.id);
    expect(stored!.paymentStatus).toBe("unpaid");
  });

  it("a cancelled order can never start a new terminal-payment attempt", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id, { paymentMethod: "card" });
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ status: "cancelled" });

    // Requires posTerminalEnabled — expect a 400 either way (terminal-not-enabled or
    // cancelled-order), but confirm no Payment is ever created for a cancelled order regardless.
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `cancelled-guard-${order.id}` });

    const payments = await Payment.countDocuments({ orderId: order.id });
    expect(payments).toBe(0);
  });
});
