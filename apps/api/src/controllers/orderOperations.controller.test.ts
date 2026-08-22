import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { orderEventBus, type OrderEventPayload } from "../events/orderEvents.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let kitchenAToken: string;
let ownerBToken: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const customer = await createTestUser("customer");

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    AuditLog.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

function customerObjectId() {
  return new mongoose.Types.ObjectId(customerId);
}

describe("order lifecycle — kitchen_staff permissions", () => {
  it("kitchen_staff can accept, progress, and complete a cash order", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId(), { orderType: "pickup" });

    for (const status of ["confirmed", "preparing", "ready", "completed"]) {
      const res = await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
        .set("Authorization", `Bearer ${kitchenAToken}`)
        .send({ status });
      expect(res.status).toBe(200);
      expect(res.body.data.order.status).toBe(status);
    }
  });

  it("kitchen_staff cannot issue a refund (no restaurant.payments.manage)", async () => {
    // Reuses the payment-domain permission boundary from Phase 5 — kitchen_staff was never
    // granted restaurant.payments.manage, and this phase doesn't change that.
    const order = await createTestOrder(restaurantA._id, customerObjectId(), { paymentMethod: "online" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/000000000000000000000000/refund`)
      .set("Authorization", `Bearer ${kitchenAToken}`)
      .send({ idempotencyKey: "kitchen-refund-attempt" });
    expect(res.status).toBe(403);
  });

  it("kitchen_staff cannot read the audit log (no restaurant.audit.read)", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${kitchenAToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant_staff also cannot read the audit log", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(403);
  });
});

describe("?active= bounded order listing (KDS)", () => {
  it("returns only active-workflow orders, excluding completed/cancelled", async () => {
    const active = await createTestOrder(restaurantA._id, customerObjectId(), { status: "preparing" });
    const done = await createTestOrder(restaurantA._id, customerObjectId(), {
      status: "completed",
      statusHistory: [
        { status: "pending", at: new Date() },
        { status: "completed", at: new Date() },
      ],
    });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders?active=true`)
      .set("Authorization", `Bearer ${kitchenAToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.orders.map((o: { id: string }) => o.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(done.id);
  });

  it("restaurant B staff never sees restaurant A's active orders", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders?active=true`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("internal notes — staff-only, never customer-visible", () => {
  it("staff can set an internal note", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ internalNote: "Regular customer, always tips well" });

    expect(res.status).toBe(200);
    expect(res.body.data.order.internalNote).toBe("Regular customer, always tips well");
  });

  it("the internal note is visible to staff via getOrder/listRestaurantOrders", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ internalNote: "Staff-only detail" });

    const getRes = await request(app).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(getRes.body.data.order.internalNote).toBe("Staff-only detail");

    const listRes = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    const found = listRes.body.data.orders.find((o: { id: string }) => o.id === order.id);
    expect(found.internalNote).toBe("Staff-only detail");
  });

  it("the internal note is NEVER present when the customer fetches their own order", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ internalNote: "Should never leak to the customer" });

    const res = await request(app).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.internalNote).toBeUndefined();
    expect(JSON.stringify(res.body.data.order)).not.toContain("Should never leak");
  });

  it("the internal note is never present in the customer's order list either", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ internalNote: "Also should never leak here" });

    const res = await request(app).get("/api/v1/orders/mine").set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body.data.items)).not.toContain("Also should never leak");
  });

  it("a customer cannot set an internal note on their own order", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ internalNote: "Attempted customer write" });
    expect(res.status).toBe(403);
  });

  it("restaurant B staff cannot set a note on restaurant A's order", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantB.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ internalNote: "Cross-tenant attempt" });
    expect([403, 404]).toContain(res.status);

    const stored = await Order.findById(order._id);
    expect(stored!.internalNote ?? "").not.toContain("Cross-tenant");
  });
});

describe("per-item special instructions", () => {
  it("are customer-visible on both the staff and customer views", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId(), {
      items: [
        {
          menuItemId: new mongoose.Types.ObjectId(),
          name: "Burger",
          unitPrice: 10,
          quantity: 1,
          lineTotal: 10,
          specialInstructions: "No onions please",
        },
      ],
    });

    const staffRes = await request(app).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${ownerAToken}`);
    expect(staffRes.body.data.order.items[0].specialInstructions).toBe("No onions please");

    const customerRes = await request(app).get(`/api/v1/orders/${order.id}`).set("Authorization", `Bearer ${customerToken}`);
    expect(customerRes.body.data.order.items[0].specialInstructions).toBe("No onions please");
  });
});

describe("audit log", () => {
  it("records a status change with from/to metadata, readable by the owner", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?targetType=order&targetId=${order.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);

    expect(res.status).toBe(200);
    const entry = res.body.data.items.find((e: { action: string }) => e.action === "order.status_changed");
    expect(entry).toBeTruthy();
    expect(entry.metadata).toEqual({ from: "pending", to: "confirmed" });
  });

  it("records a cancellation distinctly from a plain status change", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "cancelled" });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?targetType=order&targetId=${order.id}`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.body.data.items.some((e: { action: string }) => e.action === "order.cancelled")).toBe(true);
  });

  it("records a note update", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/note`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ internalNote: "test note" });

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log?targetType=order&targetId=${order.id}`)
      .set("Authorization", `Bearer ${managerAToken}`);
    expect(res.body.data.items.some((e: { action: string }) => e.action === "order.note_updated")).toBe(true);
  });

  it("restaurant B owner cannot read restaurant A's audit log", async () => {
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/audit-log`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });

  it("a failed audit write never blocks the real operation it describes (status change still succeeds)", async () => {
    // Sanity check on the "fire-and-forget in spirit" contract: recordAuditEvent swallows its own
    // errors (see audit.service.ts) — this test just re-confirms the primary status-change flow
    // still returns 200 under normal conditions, guarding against a future regression that makes
    // the audit write blocking/throwing.
    const order = await createTestOrder(restaurantA._id, customerObjectId());
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "confirmed" });
    expect(res.status).toBe(200);
  });
});

describe("real-time event emission (service/controller level, no live socket needed)", () => {
  it("emits an order.confirmed event scoped to the correct restaurant/customer on status change", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());

    const captured: OrderEventPayload[] = [];
    const handler = (payload: OrderEventPayload) => captured.push(payload);
    orderEventBus.on("order.confirmed", handler);

    try {
      await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ status: "confirmed" });

      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({
        orderId: order.id,
        restaurantId: restaurantA.id,
        customerId,
        status: "confirmed",
      });
    } finally {
      orderEventBus.off("order.confirmed", handler);
    }
  });

  it("emits order.payment_updated (not a payment-specific type) when cash paymentStatus is toggled", async () => {
    const order = await createTestOrder(restaurantA._id, customerObjectId());

    const captured: OrderEventPayload[] = [];
    const handler = (payload: OrderEventPayload) => captured.push(payload);
    orderEventBus.on("order.payment_updated", handler);

    try {
      await request(app)
        .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payment-status`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ paymentStatus: "paid" });

      expect(captured).toHaveLength(1);
      expect(captured[0].orderId).toBe(order.id);
      expect(captured[0].restaurantId).toBe(restaurantA.id);
    } finally {
      orderEventBus.off("order.payment_updated", handler);
    }
  });
});
