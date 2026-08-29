import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getMockPaymentProvider } from "../payments/index.js";
import { reconcileStalePayments } from "./payment.service.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const restaurantIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Order.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Payment.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

/** Backdates createdAt past the sweep's staleness threshold. Goes through the raw MongoDB driver
 *  collection, NOT Payment.updateOne — Mongoose's `timestamps: true` marks `createdAt` immutable
 *  by default, so a normal Mongoose-level update silently no-ops on it. */
async function backdate(paymentId: mongoose.Types.ObjectId, minutesAgo: number) {
  await Payment.collection.updateOne({ _id: paymentId }, { $set: { createdAt: new Date(Date.now() - minutesAgo * 60 * 1000) } });
}

describe("reconcileStalePayments — payment reconciliation polling fallback (Phase 35 audit fix)", () => {
  it("reconciles a payment the provider reports paid, even though no webhook ever arrived", async () => {
    const restaurant = await createTestRestaurant();
    const customer = await createTestUser("customer");
    restaurantIds.push(restaurant.id);
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, { restaurantId: restaurant._id });

    const provider = getMockPaymentProvider();
    const intent = await provider.createIntent({
      amount: 10,
      currency: "USD",
      orderId: order.id,
      restaurantId: restaurant.id,
      returnUrl: "https://example.com",
      cancelUrl: "https://example.com",
    });

    const payment = await Payment.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      customerId: customer._id,
      method: "online",
      provider: "mock",
      providerRef: intent.providerRef,
      currency: "USD",
      amount: 10,
      status: "pending",
    });
    await backdate(payment._id, 20);

    // The provider's own records show it succeeded — simulating exactly what happens when a real
    // customer completes checkout but the webhook never reaches this platform.
    provider.simulateOutcome(intent.providerRef, "paid");

    await reconcileStalePayments();

    const reconciledPayment = await Payment.findById(payment._id);
    const reconciledOrder = await Order.findById(order._id);
    expect(reconciledPayment!.status).toBe("paid");
    expect(reconciledOrder!.paymentStatus).toBe("paid");
  });

  it("leaves a stale payment untouched when the provider still reports it pending", async () => {
    const restaurant = await createTestRestaurant();
    const customer = await createTestUser("customer");
    restaurantIds.push(restaurant.id);
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, { restaurantId: restaurant._id });

    const provider = getMockPaymentProvider();
    const intent = await provider.createIntent({
      amount: 10,
      currency: "USD",
      orderId: order.id,
      restaurantId: restaurant.id,
      returnUrl: "https://example.com",
      cancelUrl: "https://example.com",
    });

    const payment = await Payment.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      customerId: customer._id,
      method: "online",
      provider: "mock",
      providerRef: intent.providerRef,
      currency: "USD",
      amount: 10,
      status: "pending",
    });
    await backdate(payment._id, 20);

    await reconcileStalePayments();

    const stillPending = await Payment.findById(payment._id);
    expect(stillPending!.status).toBe("pending");
  });

  it("does not touch a payment that isn't stale yet (created recently)", async () => {
    const restaurant = await createTestRestaurant();
    const customer = await createTestUser("customer");
    restaurantIds.push(restaurant.id);
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, { restaurantId: restaurant._id });

    const provider = getMockPaymentProvider();
    const intent = await provider.createIntent({
      amount: 10,
      currency: "USD",
      orderId: order.id,
      restaurantId: restaurant.id,
      returnUrl: "https://example.com",
      cancelUrl: "https://example.com",
    });
    provider.simulateOutcome(intent.providerRef, "paid");

    // Deliberately NOT backdated — created just now, well inside the grace window.
    const payment = await Payment.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      customerId: customer._id,
      method: "online",
      provider: "mock",
      providerRef: intent.providerRef,
      currency: "USD",
      amount: 10,
      status: "pending",
    });

    await reconcileStalePayments();

    const stillPending = await Payment.findById(payment._id);
    expect(stillPending!.status).toBe("pending");
  });
});
