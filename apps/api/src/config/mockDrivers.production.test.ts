import { afterAll, afterEach, beforeAll, describe, expect, it } from "@jest/globals";
import type { Request, Response } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "./db.js";
import { env } from "./env.js";
import { mockDriversAllowed } from "./mockDrivers.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getMockPaymentProvider } from "../payments/index.js";
import { getMockBillingProvider } from "../billing/index.js";
import { getMarketplaceProvider } from "../marketplaceProviders/index.js";
import type { MockMarketplaceProvider } from "../marketplaceProviders/MockMarketplaceProvider.js";
import { createCheckoutSessionForBusiness } from "../services/subscription.service.js";
import { completeMockCheckout, mockAdvanceSubscription } from "../controllers/billingMockDriver.controller.js";
import { mockCompleteTerminalPayment } from "../controllers/posTerminalPayment.controller.js";
import { ApiError } from "../utils/ApiError.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

/**
 * Phase 85A — a production deployment that is cash-only (PAYMENT_PROVIDER=mock) or pre-Paddle
 * (BILLING_PROVIDER=mock) must never let a simulated provider move "money". The app here is built
 * in the test environment (so every mock route IS registered, the worst case), then NODE_ENV is
 * switched to production per request to prove the request-time guards hold on their own.
 */
const app = createApp();
const mutableEnv = env as { NODE_ENV: string };

function asProduction() {
  mutableEnv.NODE_ENV = "production";
}

afterEach(() => {
  mutableEnv.NODE_ENV = "test";
});

let restaurant: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerToken: string;
let customerToken: string;
let customerId: string;

beforeAll(async () => {
  await connectDB();
  restaurant = await createTestRestaurant({ settings: { currency: "USD", onlinePaymentEnabled: true, cashEnabled: true } });
  const owner = await createTestUser("restaurant_owner", restaurant._id);
  const customer = await createTestUser("customer");
  ownerToken = tokenFor(owner);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  mutableEnv.NODE_ENV = "test";
  await Promise.all([
    Payment.deleteMany({ restaurantId: restaurant._id }),
    Order.deleteMany({ restaurantId: restaurant._id }),
    User.deleteMany({ restaurantId: restaurant._id }),
    Restaurant.deleteOne({ _id: restaurant._id }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

function onlineOrder() {
  return createTestOrder(restaurant._id, new mongoose.Types.ObjectId(customerId), { paymentMethod: "online", total: 25 });
}

async function createPendingMockPayment(orderId: string): Promise<{ id: string; providerRef: string }> {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurant.id}/orders/${orderId}/payments`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ idempotencyKey: `key-85a-${orderId}` });
  expect(res.status).toBe(201);
  return { id: res.body.data.payment.id, providerRef: res.body.data.payment.providerRef };
}

function fakeReq(params: Record<string, string>, body: unknown = {}): Request {
  return { params, body, user: { id: customerId } } as unknown as Request;
}

describe("mockDriversAllowed", () => {
  it("allows mock drivers in development and test only", () => {
    expect(mockDriversAllowed("development")).toBe(true);
    expect(mockDriversAllowed("test")).toBe(true);
    expect(mockDriversAllowed("production")).toBe(false);
  });
});

describe("mock online payments (Phase 85A)", () => {
  it("development/test: the mock provider still completes an online payment end to end", async () => {
    const order = await onlineOrder();
    const payment = await createPendingMockPayment(order.id);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/payments/${payment.id}/mock-complete`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ outcome: "paid" });
    expect(res.status).toBe(200);
    expect((await Order.findById(order._id))!.paymentStatus).toBe("paid");
  });

  it("production: an online payment cannot even be started through the mock provider", async () => {
    const order = await onlineOrder();
    asProduction();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/payments`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ idempotencyKey: `key-85a-prod-${order.id}` });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/pay with cash/);
    expect(await Payment.countDocuments({ orderId: order._id })).toBe(0);
  });

  it("production: an owner cannot switch on online payments with only the mock provider", async () => {
    await Restaurant.updateOne({ _id: restaurant._id }, { "settings.onlinePaymentEnabled": false });
    asProduction();
    const res = await request(app)
      .patch(`/api/v1/restaurants/${restaurant.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ settings: { onlinePaymentEnabled: true } });
    expect(res.status).toBe(400);
    mutableEnv.NODE_ENV = "test";
    expect((await Restaurant.findById(restaurant._id))!.settings.onlinePaymentEnabled).toBe(false);
    await Restaurant.updateOne({ _id: restaurant._id }, { "settings.onlinePaymentEnabled": true });
  });

  it("production: the mock-complete route cannot mark a pending payment paid", async () => {
    const order = await onlineOrder();
    const payment = await createPendingMockPayment(order.id);
    asProduction();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/payments/${payment.id}/mock-complete`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ outcome: "paid" });
    expect(res.status).toBe(404);
    expect((await Payment.findById(payment.id))!.status).toBe("pending");
    expect((await Order.findById(order._id))!.paymentStatus).toBe("unpaid");
  });

  it("production: a correctly signed mock payment webhook is refused (the same payload is accepted in test)", async () => {
    const order = await onlineOrder();
    const payment = await createPendingMockPayment(order.id);
    const mock = getMockPaymentProvider();
    const { rawBody, signatureHeader } = mock.signPayload(mock.simulateOutcome(payment.providerRef, "paid"));
    const send = () =>
      request(app)
        .post("/api/v1/webhooks/payments/mock")
        .set("Content-Type", "application/json")
        .set(mock.signatureHeaderName, signatureHeader)
        .send(rawBody.toString("utf-8"));

    asProduction();
    expect((await send()).status).toBe(404);
    mutableEnv.NODE_ENV = "test";
    expect((await Order.findById(order._id))!.paymentStatus).toBe("unpaid");

    expect((await send()).status).toBe(200);
    expect((await Order.findById(order._id))!.paymentStatus).toBe("paid");
  });
});

describe("mock billing, marketplace and terminal drivers (Phase 85A)", () => {
  it("production: a correctly signed mock billing webhook is refused", async () => {
    const mock = getMockBillingProvider();
    const { rawBody, signatureHeader } = mock.signPayload({ eventId: "evt_85a", eventType: "subscription.updated" });
    asProduction();
    const res = await request(app)
      .post("/api/v1/webhooks/billing/mock")
      .set("Content-Type", "application/json")
      .set(mock.signatureHeaderName, signatureHeader)
      .send(rawBody.toString("utf-8"));
    expect(res.status).toBe(404);
  });

  it("production: the public mock checkout completion route is refused", async () => {
    asProduction();
    const res = await request(app).post("/api/v1/billing/mock-checkout/any-token/complete").send({});
    expect(res.status).toBe(404);
  });

  it("production: paid-plan checkout through the mock billing provider fails clearly", async () => {
    asProduction();
    await expect(createCheckoutSessionForBusiness(new mongoose.Types.ObjectId().toString(), "owner_growth", "monthly")).rejects.toMatchObject({
      statusCode: 503,
    });
  });

  it("production: the mock subscription-advance and mock checkout controllers refuse even if called directly", async () => {
    asProduction();
    await expect(mockAdvanceSubscription(fakeReq({ businessId: "x" }, { status: "active" }), {} as Response)).rejects.toBeInstanceOf(ApiError);
    await expect(completeMockCheckout(fakeReq({ token: "x" }), {} as Response)).rejects.toBeInstanceOf(ApiError);
    await expect(
      mockCompleteTerminalPayment(fakeReq({ restaurantId: "x", orderId: "y", paymentId: "z" }, { outcome: "approved" }), {} as Response)
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("production: a correctly signed mock marketplace webhook is refused", async () => {
    const mock = getMarketplaceProvider("uber_eats") as MockMarketplaceProvider;
    const payload = mock.simulateInboundOrder({
      externalOrderId: "ext-85a",
      externalStoreId: "store-85a",
      items: [],
      customerName: "Forged",
      total: 1,
    } as unknown as Parameters<MockMarketplaceProvider["simulateInboundOrder"]>[0]);
    const { rawBody, signatureHeader } = mock.signPayload(payload);
    asProduction();
    const res = await request(app)
      .post("/api/v1/webhooks/marketplace/uber_eats")
      .set("Content-Type", "application/json")
      .set(mock.signatureHeaderName, signatureHeader)
      .send(rawBody.toString("utf-8"));
    expect(res.status).toBe(404);
  });
});
