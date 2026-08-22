import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Refund } from "../models/Refund.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getMockPaymentProvider } from "../payments/index.js";
import {
  closeTestConnections,
  createTestOrder,
  createTestPayment,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let managerAToken: string;
let staffAToken: string;
let ownerBToken: string;
let customerToken: string;
let customerId: string;
let otherCustomerToken: string;
let otherCustomerId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({ settings: { currency: "USD" } });
  restaurantB = await createTestRestaurant({ settings: { currency: "USD" } });

  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const managerA = await createTestUser("restaurant_manager", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const customer = await createTestUser("customer");
  const otherCustomer = await createTestUser("customer");

  ownerAToken = tokenFor(ownerA);
  managerAToken = tokenFor(managerA);
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  customerToken = tokenFor(customer);
  customerId = customer.id;
  otherCustomerToken = tokenFor(otherCustomer);
  otherCustomerId = otherCustomer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    Refund.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    User.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteMany({ _id: { $in: [customerId, otherCustomerId] } });
  await closeTestConnections();
});

function onlineOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return createTestOrder(restaurantA._id, new mongoose.Types.ObjectId(customerId), {
    paymentMethod: "online",
    total: 42,
    ...overrides,
  });
}

describe("payment creation", () => {
  it("creates a payment for an online order, snapshotting the server-computed total (never a client amount)", async () => {
    const order = await onlineOrder({ total: 33.5 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-${order.id}`, amount: 1 }); // amount is not a real field — ignored

    expect(res.status).toBe(201);
    expect(res.body.data.payment.amount).toBe(33.5);
    expect(res.body.data.payment.status).toBe("pending");
    expect(res.body.data.payment.provider).toBe("mock");
    expect(res.body.data.clientSecret).toEqual(expect.any(String));
  });

  it("rejects creating a payment for an order that belongs to a different restaurant", async () => {
    const order = await onlineOrder();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-wrong-restaurant-${order.id}` });

    expect(res.status).toBe(404);
  });

  it("rejects creating a payment for an order that doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/6a0000000000000000000000/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: "key-nonexistent-order" });

    expect(res.status).toBe(404);
  });

  it("rejects a payment attempt from a customer who doesn't own the order", async () => {
    const order = await onlineOrder();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${otherCustomerToken}`)
      .send({ idempotencyKey: `key-not-owner-${order.id}` });

    expect(res.status).toBe(403);
  });

  it("rejects creating a payment for a cash order", async () => {
    const order = await createTestOrder(restaurantA._id, new mongoose.Types.ObjectId(customerId), {
      paymentMethod: "cash",
    });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-cash-${order.id}` });

    expect(res.status).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    const order = await onlineOrder();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .send({ idempotencyKey: `key-unauth-${order.id}` });

    expect(res.status).toBe(401);
  });

  it("is idempotent: a duplicate request with the same idempotencyKey returns the same payment, not a new one", async () => {
    const order = await onlineOrder();
    const key = `key-dup-${order.id}`;

    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: key });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: key });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.payment.id).toBe(first.body.data.payment.id);

    const count = await Payment.countDocuments({ orderId: order._id });
    expect(count).toBe(1);
  });

  it("reuses an existing non-terminal payment attempt instead of creating a second one for the same order", async () => {
    const order = await onlineOrder();

    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-retry-a-${order.id}` });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-retry-b-${order.id}` }); // different key, same order

    expect(first.body.data.payment.id).toBe(second.body.data.payment.id);
  });

  it("rejects creating a payment for an order that's already paid", async () => {
    const order = await onlineOrder({ paymentStatus: "paid" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-already-paid-${order.id}` });

    expect(res.status).toBe(409);
  });

  it("rejects creating a payment for an order whose restaurant was suspended after the order was placed (Phase 16)", async () => {
    const order = await onlineOrder();
    await Restaurant.findByIdAndUpdate(restaurantA._id, { status: "suspended" });
    try {
      const res = await request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ idempotencyKey: `key-suspended-${order.id}` });
      expect(res.status).toBe(400);
    } finally {
      await Restaurant.findByIdAndUpdate(restaurantA._id, { status: "active" });
    }
  });
});

describe("payment state via the mock provider + real webhook signature path", () => {
  it("pending -> paid via a signed webhook flips both Payment.status and Order.paymentStatus", async () => {
    const order = await onlineOrder({ total: 20 });
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-flow-${order.id}` });
    const paymentId = createRes.body.data.payment.id;

    const completeRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ outcome: "paid" });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.payment.status).toBe("paid");

    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.paymentStatus).toBe("paid");
  });

  it("pending -> failed leaves the order unpaid", async () => {
    const order = await onlineOrder({ total: 15 });
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-fail-${order.id}` });
    const paymentId = createRes.body.data.payment.id;

    const completeRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ outcome: "failed" });

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.data.payment.status).toBe("failed");

    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.paymentStatus).toBe("unpaid");
  });

  it("a customer cannot drive the mock-complete flow for someone else's payment", async () => {
    const order = await onlineOrder();
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-other-${order.id}` });
    const paymentId = createRes.body.data.payment.id;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${otherCustomerToken}`)
      .send({ outcome: "paid" });

    expect(res.status).toBe(403);
  });
});

describe("payment visibility", () => {
  it("the owning customer can list and fetch their order's payments", async () => {
    const order = await onlineOrder();
    const payment = await createTestPayment(restaurantA._id, order._id, order.customerId);

    const list = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.payments.some((p: { id: string }) => p.id === payment.id)).toBe(true);

    const get = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(get.status).toBe(200);
  });

  it("restaurant staff (orders.read) can view payments for orders in their own restaurant", async () => {
    const order = await onlineOrder();
    const payment = await createTestPayment(restaurantA._id, order._id, order.customerId);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}`)
      .set("Authorization", `Bearer ${staffAToken}`);
    expect(res.status).toBe(200);
  });

  it("a different customer cannot view someone else's payment", async () => {
    const order = await onlineOrder();
    const payment = await createTestPayment(restaurantA._id, order._id, order.customerId);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}`)
      .set("Authorization", `Bearer ${otherCustomerToken}`);
    expect(res.status).toBe(403);
  });

  it("restaurant B staff cannot view restaurant A's payments (cross-tenant)", async () => {
    const order = await onlineOrder();
    const payment = await createTestPayment(restaurantA._id, order._id, order.customerId);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}`)
      .set("Authorization", `Bearer ${ownerBToken}`);
    expect(res.status).toBe(403);
  });
});

describe("refunds", () => {
  // Drives the real create -> mock-complete flow rather than fabricating a Payment document
  // directly: refund() calls the mock provider's refund(providerRef, ...), which looks the
  // reference up in its own in-memory state — exactly as a real provider would look it up on its
  // own side. A Payment inserted with a made-up providerRef that never went through
  // createIntent() legitimately doesn't exist there, so refunding it would (correctly) fail.
  async function paidOrderWithPayment(total = 40) {
    const order = await onlineOrder({ total });
    const createRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `paid-setup-${order.id}` });
    const paymentId = createRes.body.data.payment.id;
    await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${paymentId}/mock-complete`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ outcome: "paid" });
    const payment = (await Payment.findById(paymentId))!;
    return { order, payment };
  }

  it("owner can fully refund a paid payment", async () => {
    const { order, payment } = await paidOrderWithPayment(40);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `refund-full-${payment.id}`, reason: "Customer complaint" });

    expect(res.status).toBe(201);
    expect(res.body.data.refund.amount).toBe(40);
    expect(res.body.data.refund.status).toBe("succeeded");

    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("refunded");
  });

  it("owner can partially refund, and the payment status becomes partially_refunded", async () => {
    const { order, payment } = await paidOrderWithPayment(40);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `refund-partial-${payment.id}`, amount: 10 });

    expect(res.status).toBe(201);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("partially_refunded");
  });

  it("rejects a refund exceeding the remaining refundable amount", async () => {
    const { order, payment } = await paidOrderWithPayment(40);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `refund-toobig-${payment.id}`, amount: 999 });

    expect(res.status).toBe(400);
  });

  it("rejects refunding a payment that was never paid", async () => {
    const order = await onlineOrder();
    const payment = await createTestPayment(restaurantA._id, order._id, order.customerId, { status: "pending" });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `refund-unpaid-${payment.id}` });

    expect(res.status).toBe(400);
  });

  it("restaurant_staff (no restaurant.payments.manage) cannot issue a refund", async () => {
    const { order, payment } = await paidOrderWithPayment(25);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${staffAToken}`)
      .send({ idempotencyKey: `refund-staff-${payment.id}` });

    expect(res.status).toBe(403);
  });

  it("restaurant_manager CAN issue a refund", async () => {
    const { order, payment } = await paidOrderWithPayment(25);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${managerAToken}`)
      .send({ idempotencyKey: `refund-manager-${payment.id}` });

    expect(res.status).toBe(201);
  });

  it("a customer cannot issue a refund", async () => {
    const { order, payment } = await paidOrderWithPayment(25);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `refund-customer-${payment.id}` });

    expect(res.status).toBe(403);
  });

  it("restaurant B's owner cannot refund restaurant A's payment (cross-tenant)", async () => {
    const { order, payment } = await paidOrderWithPayment(25);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ idempotencyKey: `refund-crosstenant-${payment.id}` });

    expect([403, 404]).toContain(res.status);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("paid");
  });

  it("is idempotent: a duplicate refund request with the same idempotencyKey doesn't refund twice", async () => {
    const { order, payment } = await paidOrderWithPayment(40);
    const key = `refund-dup-${payment.id}`;

    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: key, amount: 10 });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: key, amount: 10 });

    expect(first.status).toBe(201);
    expect(second.body.data.refund.id).toBe(first.body.data.refund.id);

    const count = await Refund.countDocuments({ paymentId: payment._id });
    expect(count).toBe(1);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("partially_refunded"); // only applied once, not twice
  });

  it("under true concurrency, two simultaneous refund requests can never together exceed the payment amount (Phase 16)", async () => {
    const { order, payment } = await paidOrderWithPayment(40);

    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ idempotencyKey: `refund-race-a-${payment.id}`, amount: 30 }),
      request(app)
        .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
        .set("Authorization", `Bearer ${ownerAToken}`)
        .send({ idempotencyKey: `refund-race-b-${payment.id}`, amount: 30 }),
    ]);

    // Both requested 30 against a 40 total (60 combined) — only one can actually be reserved.
    // The loser gets a clean conflict, never a second successful refund that overshoots the
    // payment amount. See services/payment.service.ts's refundPayment doc comment.
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const stored = await Payment.findById(payment._id);
    expect(stored!.totalRefunded).toBe(30);
    expect(stored!.status).toBe("partially_refunded");

    const succeededCount = await Refund.countDocuments({ paymentId: payment._id, status: "succeeded" });
    expect(succeededCount).toBe(1);
  });

  it("cancelling a paid order does NOT auto-refund it (Phase 17 product decision — refund stays an explicit staff action)", async () => {
    const { order, payment } = await paidOrderWithPayment(40);
    expect((await Payment.findById(payment._id))!.status).toBe("paid");

    const cancelRes = await request(app)
      .patch(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ status: "cancelled" });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.order.status).toBe("cancelled");

    // The payment is untouched by the cancellation — still "paid", not "refunded"/"cancelled".
    const stillPaid = await Payment.findById(payment._id);
    expect(stillPaid!.status).toBe("paid");
    expect(stillPaid!.totalRefunded).toBe(0);

    // And it's still refundable afterward — cancellation doesn't lock staff out of the explicit
    // refund action either, it just doesn't fire it automatically.
    const refundRes = await request(app)
      .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${payment.id}/refund`)
      .set("Authorization", `Bearer ${ownerAToken}`)
      .send({ idempotencyKey: `post-cancel-refund-${payment.id}` });
    expect(refundRes.status).toBe(201);
    expect((await Payment.findById(payment._id))!.status).toBe("refunded");
  });
});

describe("mock provider sanity", () => {
  it("is the only configured provider in this test environment", () => {
    expect(getMockPaymentProvider().name).toBe("mock");
  });
});
