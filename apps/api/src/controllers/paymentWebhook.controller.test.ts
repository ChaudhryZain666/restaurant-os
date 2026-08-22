import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getMockPaymentProvider } from "../payments/index.js";
import { closeTestConnections, createTestOrder, createTestPayment, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const app = createApp();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant();
  restaurantB = await createTestRestaurant();
  const customer = await createTestUser("customer");
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    PaymentWebhookEvent.deleteMany({}),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

async function pendingPayment(restaurantId: mongoose.Types.ObjectId) {
  const order = await createTestOrder(restaurantId, new mongoose.Types.ObjectId(customerId), {
    paymentMethod: "online",
    total: 18,
  });
  const payment = await createTestPayment(restaurantId, order._id, order.customerId, {
    status: "pending",
    providerRef: `mock_pi_webhooktest_${new mongoose.Types.ObjectId().toString()}`,
  });
  return { order, payment };
}

function signedEvent(providerRef: string, status: "paid" | "failed" | "cancelled" | "requires_action" | "authorized" | "pending", eventType = "payment.succeeded") {
  const provider = getMockPaymentProvider();
  const payload = {
    eventId: `evt_${new mongoose.Types.ObjectId().toString()}`,
    eventType,
    providerRef,
    status,
  };
  const { rawBody, signatureHeader } = provider.signPayload(payload);
  return { rawBody, signatureHeader, eventId: payload.eventId };
}

function signedPaidEvent(providerRef: string) {
  return signedEvent(providerRef, "paid");
}

async function postWebhook(rawBody: Buffer, signatureHeader: string) {
  return request(app)
    .post("/api/v1/webhooks/payments/mock")
    .set("Content-Type", "application/json")
    .set("x-payment-signature", signatureHeader)
    .send(rawBody.toString("utf-8"));
}

describe("POST /webhooks/payments/:provider — signature verification", () => {
  it("accepts a validly-signed event and applies the payment/order transition", async () => {
    const { order, payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader } = signedPaidEvent(payment.providerRef!);

    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(200);

    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment!.status).toBe("paid");
    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.paymentStatus).toBe("paid");
  });

  it("rejects a request with no signature header", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { rawBody } = signedPaidEvent(payment.providerRef!);

    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(400);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("pending");
  });

  it("rejects a request with a tampered/incorrect signature", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { rawBody } = signedPaidEvent(payment.providerRef!);

    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", "sha256=0000000000000000000000000000000000000000000000000000000000000000")
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(400);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("pending");
  });

  it("rejects a body that was modified after signing (signature no longer matches)", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { signatureHeader } = signedPaidEvent(payment.providerRef!);
    const tampered = Buffer.from(
      JSON.stringify({ eventId: "evt_tampered", eventType: "payment.succeeded", providerRef: payment.providerRef, status: "paid" })
    );

    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(tampered.toString("utf-8"));

    expect(res.status).toBe(400);
  });

  it("rejects a webhook posted to the wrong provider path", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader } = signedPaidEvent(payment.providerRef!);

    const res = await request(app)
      .post("/api/v1/webhooks/payments/stripe")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(400);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("pending");
  });
});

describe("webhook idempotency and duplicate protection", () => {
  it("processing the same event twice does not double-apply the transition or create a second event record", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader, eventId } = signedPaidEvent(payment.providerRef!);

    const first = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));
    const second = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // still acknowledged — a provider retry must not error out

    const eventCount = await PaymentWebhookEvent.countDocuments({ provider: "mock", eventId });
    expect(eventCount).toBe(1);

    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("paid");
  });

  it("an event for an unknown provider reference is acknowledged but changes nothing", async () => {
    const { rawBody, signatureHeader } = signedPaidEvent(`mock_pi_never_existed_${new mongoose.Types.ObjectId().toString()}`);

    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(200);
  });

  it("an event only ever affects the one payment its providerRef matches, never another restaurant's payment", async () => {
    const { payment: paymentA } = await pendingPayment(restaurantA._id);
    const { payment: paymentB } = await pendingPayment(restaurantB._id);
    const { rawBody, signatureHeader } = signedPaidEvent(paymentA.providerRef!);

    await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", signatureHeader)
      .send(rawBody.toString("utf-8"));

    const storedA = await Payment.findById(paymentA._id);
    const storedB = await Payment.findById(paymentB._id);
    expect(storedA!.status).toBe("paid");
    expect(storedB!.status).toBe("pending"); // untouched
  });

  it("an invalid transition (e.g. an already-paid payment receiving another 'paid' event) is ignored, not reapplied", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const firstEvent = signedPaidEvent(payment.providerRef!);
    await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", firstEvent.signatureHeader)
      .send(firstEvent.rawBody.toString("utf-8"));

    // A second, DIFFERENT event (new eventId) reporting "paid" again for the same already-paid payment.
    const secondEvent = signedPaidEvent(payment.providerRef!);
    const res = await request(app)
      .post("/api/v1/webhooks/payments/mock")
      .set("Content-Type", "application/json")
      .set("x-payment-signature", secondEvent.signatureHeader)
      .send(secondEvent.rawBody.toString("utf-8"));

    expect(res.status).toBe(200); // acknowledged, not an error
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("paid"); // unchanged, not re-processed
  });
});

describe("payment/order state machine — every terminal and intermediate outcome", () => {
  it("FAILURE: a failed webhook event leaves the payment failed and the order unpaid, never falsely marked paid", async () => {
    const { order, payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader } = signedEvent(payment.providerRef!, "failed", "payment.failed");

    const res = await postWebhook(rawBody, signatureHeader);

    expect(res.status).toBe(200);
    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment!.status).toBe("failed");
    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.paymentStatus).toBe("unpaid");
  });

  it("CANCELLED: a cancelled webhook event leaves the payment cancelled and the order unpaid", async () => {
    const { order, payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader } = signedEvent(payment.providerRef!, "cancelled", "payment.cancelled");

    const res = await postWebhook(rawBody, signatureHeader);

    expect(res.status).toBe(200);
    const storedPayment = await Payment.findById(payment._id);
    expect(storedPayment!.status).toBe("cancelled");
    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.paymentStatus).toBe("unpaid");
  });

  it("PENDING: a requires_action event is retained as an intermediate state, not treated as terminal", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const { rawBody, signatureHeader } = signedEvent(payment.providerRef!, "requires_action", "payment.requires_action");

    const res = await postWebhook(rawBody, signatureHeader);

    expect(res.status).toBe(200);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("requires_action");
  });

  it("PENDING -> requires_action -> paid: a later webhook correctly advances an intermediate state", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const step1 = signedEvent(payment.providerRef!, "requires_action", "payment.requires_action");
    await postWebhook(step1.rawBody, step1.signatureHeader);

    const step2 = signedEvent(payment.providerRef!, "paid");
    const res = await postWebhook(step2.rawBody, step2.signatureHeader);

    expect(res.status).toBe(200);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("paid");
  });

  it("OUT-OF-ORDER: a stale 'pending' event arriving after the payment already succeeded cannot regress it", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const paidEvent = signedPaidEvent(payment.providerRef!);
    await postWebhook(paidEvent.rawBody, paidEvent.signatureHeader);

    // A delayed/out-of-order delivery reporting an earlier state for the same payment.
    const staleEvent = signedEvent(payment.providerRef!, "pending", "payment.pending");
    const res = await postWebhook(staleEvent.rawBody, staleEvent.signatureHeader);

    expect(res.status).toBe(200); // acknowledged, never a hard error for the provider
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("paid"); // still paid — the state machine has no paid -> pending transition
  });

  it("UNKNOWN/MALFORMED: a validly-signed payload missing required fields is safely rejected without corrupting state", async () => {
    const { payment } = await pendingPayment(restaurantA._id);
    const provider = getMockPaymentProvider();
    // Signed correctly, but missing eventType/status — verifyWebhookSignature must return null for
    // this, not guess at a status.
    const malformed = { eventId: `evt_${new mongoose.Types.ObjectId().toString()}`, providerRef: payment.providerRef };
    const { rawBody, signatureHeader } = provider.signPayload(malformed);

    const res = await postWebhook(rawBody, signatureHeader);

    expect(res.status).toBe(400);
    const stored = await Payment.findById(payment._id);
    expect(stored!.status).toBe("pending"); // untouched
  });
});
