import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { applyOrderStatusTransition } from "./orderTransition.service.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const restaurantIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Order.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

/**
 * Phase 40 built the dispatch-trigger itself; Phase 50 added a retry/backoff safety net to it
 * (see this function's own doc comment) — this file gives that trigger its first direct test
 * coverage, since it was previously only exercised indirectly through
 * deliveryDispatch.service.test.ts (which calls createDeliveryForOrder directly, bypassing this
 * enqueue step entirely) and order.controller.test.ts's broader HTTP-level status-transition tests.
 */
describe("applyOrderStatusTransition — delivery dispatch enqueue (Phase 40/50)", () => {
  it("enqueues delivery.dispatch_create with a retry/backoff safety net when a delivery order reaches 'ready'", async () => {
    const restaurant = await createTestRestaurant();
    restaurantIds.push(restaurant.id);
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, {
      orderType: "delivery",
      status: "preparing",
      statusHistory: [
        { status: "pending", at: new Date() },
        { status: "confirmed", at: new Date() },
        { status: "preparing", at: new Date() },
      ],
      deliveryAddress: { line1: "1 Test Ave", city: "Karachi", latitude: 24.9, longitude: 67.05 },
    });
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);

    await applyOrderStatusTransition({ orderId: order.id as string, restaurantId: restaurant.id as string, nextStatus: "ready" });

    expect(addSpy).toHaveBeenCalledWith(
      "delivery.dispatch_create",
      { orderId: order.id, restaurantId: restaurant.id },
      { attempts: 3, backoff: { type: "exponential", delay: 5000 } }
    );
  });

  it("does NOT enqueue a dispatch job for a pickup order reaching 'ready'", async () => {
    const restaurant = await createTestRestaurant();
    restaurantIds.push(restaurant.id);
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, {
      orderType: "pickup",
      status: "preparing",
      statusHistory: [
        { status: "pending", at: new Date() },
        { status: "confirmed", at: new Date() },
        { status: "preparing", at: new Date() },
      ],
    });
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);

    await applyOrderStatusTransition({ orderId: order.id as string, restaurantId: restaurant.id as string, nextStatus: "ready" });

    expect(addSpy).not.toHaveBeenCalled();
  });

  it("does NOT enqueue a dispatch job for a delivery order moving between two non-'ready' statuses", async () => {
    const restaurant = await createTestRestaurant();
    restaurantIds.push(restaurant.id);
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, {
      orderType: "delivery",
      status: "confirmed",
      statusHistory: [
        { status: "pending", at: new Date() },
        { status: "confirmed", at: new Date() },
      ],
      deliveryAddress: { line1: "1 Test Ave", city: "Karachi", latitude: 24.9, longitude: 67.05 },
    });
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);

    await applyOrderStatusTransition({ orderId: order.id as string, restaurantId: restaurant.id as string, nextStatus: "preparing" });

    expect(addSpy).not.toHaveBeenCalled();
  });
});
