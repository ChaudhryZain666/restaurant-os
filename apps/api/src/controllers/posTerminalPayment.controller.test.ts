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
import { closeTestConnections, createTestCategory, createTestMenuItem, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

/**
 * Phase 74 — end to end against the real posRouter, real Payment model, and the real (mock)
 * PaymentTerminalProvider. Requires env.POS_TERMINAL_PROVIDER=mock (set in apps/api/.env, which
 * apps/api/.env.test merges with — see that file's own comment) — if this suite ever runs with
 * POS_TERMINAL_PROVIDER=none, the "terminal not configured at all" describe block below is what's
 * actually exercised instead, still meaningfully (it proves the honest-by-default rejection).
 */
const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantNoTerminal: Awaited<ReturnType<typeof createTestRestaurant>>;
let staffAToken: string;
let kitchenAToken: string;
let ownerBToken: string;
let noTerminalOwnerToken: string;
let itemA: Awaited<ReturnType<typeof createTestMenuItem>>;
let itemNoTerminal: Awaited<ReturnType<typeof createTestMenuItem>>;

async function ringUpOrder(token: string, restaurantId: string, itemId: string) {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurantId}/pos/orders`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      customer: { name: "Terminal Test Customer" },
      items: [{ menuItemId: itemId, quantity: 1, selectedModifiers: [] }],
      orderType: "pickup",
      paymentMethod: "card",
      markPaidImmediately: false,
    });
  expect(res.status).toBe(201);
  return res.body.data.order as { id: string; total: number };
}

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({
    settings: {
      orderingEnabled: true,
      pickupEnabled: true,
      cashEnabled: true,
      posEnabled: true,
      posTerminalEnabled: true,
      minOrderAmount: 0,
      taxRate: 0,
      deliveryFee: 0,
    },
  });
  restaurantB = await createTestRestaurant({
    settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, posEnabled: true, posTerminalEnabled: true, minOrderAmount: 0, taxRate: 0 },
  });
  restaurantNoTerminal = await createTestRestaurant({
    // posEnabled: true but posTerminalEnabled left at its default (false) — the two-factor gate.
    settings: { orderingEnabled: true, pickupEnabled: true, cashEnabled: true, posEnabled: true, minOrderAmount: 0, taxRate: 0 },
  });

  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const kitchenA = await createTestUser("kitchen_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const noTerminalOwner = await createTestUser("restaurant_owner", restaurantNoTerminal._id);
  staffAToken = tokenFor(staffA);
  kitchenAToken = tokenFor(kitchenA);
  ownerBToken = tokenFor(ownerB);
  noTerminalOwnerToken = tokenFor(noTerminalOwner);

  const categoryA = await createTestCategory(restaurantA._id);
  itemA = await createTestMenuItem(restaurantA._id, categoryA._id, { price: 10 });
  const categoryNoTerminal = await createTestCategory(restaurantNoTerminal._id);
  itemNoTerminal = await createTestMenuItem(restaurantNoTerminal._id, categoryNoTerminal._id, { price: 10 });
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id, restaurantNoTerminal._id];
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

describe("POS terminal payment — access control", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app).post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/000000000000000000000000/terminal-payment`).send({});
    expect(res.status).toBe(401);
  });

  it("kitchen_staff cannot initiate a terminal payment (lacks restaurant.pos.operate)", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${kitchenAToken}`)
      .send({ idempotencyKey: "kitchen-attempt-00000000" });
    expect(res.status).toBe(403);
  });

  it("restaurant B cannot initiate a terminal payment against restaurant A's order (tenant isolation)", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ idempotencyKey: "cross-tenant-attempt-0" });
    expect(res.status).toBe(403);
  });

  it("rejects when the location hasn't opted into a card terminal, even though POS itself is enabled", async () => {
    const order = await ringUpOrder(noTerminalOwnerToken, restaurantNoTerminal.id, itemNoTerminal.id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantNoTerminal.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${noTerminalOwnerToken}`)
      .send({ idempotencyKey: "no-terminal-attempt-00" });
    expect(res.status).toBe(400);
  });
});

describe("POS terminal payment — lifecycle", () => {
  it("creates a real Payment (method: pos_terminal), reuses the same idempotency key, and reuses an in-flight attempt under a NEW key too", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const key = `lifecycle-key-${order.id}`;

    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(first.body.data.payment.method).toBe("pos_terminal");
    expect(first.body.data.payment.status).toBe("requires_action");
    expect(first.body.data.payment.amount).toBe(order.total);

    // Same key -> the exact same payment, not a second one.
    const dup = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: key });
    expect(dup.status).toBe(200);
    expect(dup.body.data.payment.id).toBe(first.body.data.payment.id);

    // A genuinely different key, while the first attempt is still in flight, also reuses it —
    // the "one in-flight attempt per order" guard, independent of idempotency keys.
    const differentKeySameOrder = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `different-${key}` });
    expect(differentKeySameOrder.status).toBe(200);
    expect(differentKeySameOrder.body.data.payment.id).toBe(first.body.data.payment.id);

    const count = await Payment.countDocuments({ orderId: order.id });
    expect(count).toBe(1);
  });

  it("approved: polling after a mock-complete(paid) marks both the Payment and the Order paid — never before", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `approved-key-${order.id}` });
    const paymentId = create.body.data.payment.id;

    // Not paid yet — the mere existence of a terminal attempt never marks anything paid.
    const stillUnpaid = await Order.findById(order.id);
    expect(stillUnpaid!.paymentStatus).toBe("unpaid");

    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ outcome: "paid" });

    const poll = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(poll.body.data.payment.status).toBe("paid");

    const orderAfter = await Order.findById(order.id);
    expect(orderAfter!.paymentStatus).toBe("paid");
  });

  it("declined: order stays unpaid, and a retry with a fresh key creates a genuinely separate attempt", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `declined-key-${order.id}` });
    const paymentId = create.body.data.payment.id;

    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ outcome: "failed" });

    const poll = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(poll.body.data.payment.status).toBe("failed");
    expect((await Order.findById(order.id))!.paymentStatus).toBe("unpaid");

    // Retry — a fresh idempotency key must create a SECOND, independent Payment (the failed one
    // is terminal, never reused), and that new one can still succeed.
    const retry = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `retry-key-${order.id}` });
    expect(retry.status).toBe(201);
    expect(retry.body.data.payment.id).not.toBe(paymentId);

    const count = await Payment.countDocuments({ orderId: order.id });
    expect(count).toBe(2);
  });

  it("staff cancel: an in-flight attempt can be cancelled directly (not only via the mock driver), and the order stays unpaid", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `cancel-key-${order.id}` });
    const paymentId = create.body.data.payment.id;

    const cancel = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}/cancel`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.payment.status).toBe("cancelled");
    expect((await Order.findById(order.id))!.paymentStatus).toBe("unpaid");
  });

  it("a paid order can never start a second terminal payment attempt (no double charge)", async () => {
    const order = await ringUpOrder(staffAToken, restaurantA.id, itemA.id);
    const create = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `paid-guard-key-${order.id}` });
    const paymentId = create.body.data.payment.id;
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ outcome: "paid" });
    await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment/${paymentId}`)
      .set("Authorization", `Bearer ${staffAToken}`);

    const secondAttempt = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/pos/orders/${order.id}/terminal-payment`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `second-attempt-key-${order.id}` });
    expect(secondAttempt.status).toBe(409);

    const paidCount = await Payment.countDocuments({ orderId: order.id, status: "paid" });
    expect(paidCount).toBe(1);
  });
});
