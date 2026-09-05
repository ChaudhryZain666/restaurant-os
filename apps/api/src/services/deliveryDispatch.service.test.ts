import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { Delivery } from "../models/Delivery.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import {
  cancelDelivery,
  createDeliveryForOrder,
  retryDeliveryCreation,
  updateDeliveryStatus,
} from "./deliveryDispatch.service.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const restaurantIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Delivery.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Order.deleteMany({ restaurantId: { $in: restaurantIds } });
  await Restaurant.deleteMany({ _id: { $in: restaurantIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

async function deliveryReadyRestaurant() {
  const restaurant = await createTestRestaurant({
    latitude: 24.8607,
    longitude: 67.0011,
    address: "1 Test Street",
    city: "Karachi",
    phone: "+920000000000",
  });
  restaurantIds.push(restaurant.id);
  return restaurant;
}

async function deliveryOrder(restaurantId: mongoose.Types.ObjectId, customerId: mongoose.Types.ObjectId) {
  return createTestOrder(restaurantId, customerId, {
    orderType: "delivery",
    status: "ready",
    statusHistory: [
      { status: "pending", at: new Date() },
      { status: "confirmed", at: new Date() },
      { status: "preparing", at: new Date() },
      { status: "ready", at: new Date() },
    ],
    deliveryAddress: {
      line1: "42 Customer Lane",
      city: "Karachi",
      latitude: 24.87,
      longitude: 67.02,
    },
  });
}

describe("createDeliveryForOrder — manual provider (default, always available)", () => {
  it("creates a Delivery immediately in 'accepted' status with a providerDeliveryId", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);

    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    expect(delivery.provider).toBe("manual");
    expect(delivery.status).toBe("accepted");
    expect(delivery.providerDeliveryId).toMatch(/^manual_/);
    expect(delivery.idempotencyKey).toBe(`delivery_create_${order.id}`);
  });

  it("is idempotent — a second call for the same order returns the exact same Delivery document", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);

    const first = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    const second = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    expect(second.id).toBe(first.id);
    const count = await Delivery.countDocuments({ orderId: order._id });
    expect(count).toBe(1);
  });

  it("concurrent calls for the same order race safely down to exactly one Delivery document", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);

    const [a, b, c] = await Promise.all([
      createDeliveryForOrder(order.id as string, restaurant.id as string),
      createDeliveryForOrder(order.id as string, restaurant.id as string),
      createDeliveryForOrder(order.id as string, restaurant.id as string),
    ]);

    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    const count = await Delivery.countDocuments({ orderId: order._id });
    expect(count).toBe(1);
  });

  it("rejects a pickup order (only delivery orders can be dispatched to a courier)", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await createTestOrder(restaurant._id, customer._id, { orderType: "pickup" });

    await expect(createDeliveryForOrder(order.id as string, restaurant.id as string)).rejects.toThrow();
  });

  it("rejects a delivery order whose restaurant has no pickup coordinates configured", async () => {
    const restaurant = await createTestRestaurant();
    restaurantIds.push(restaurant.id);
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);

    await expect(createDeliveryForOrder(order.id as string, restaurant.id as string)).rejects.toThrow();
  });
});

describe("updateDeliveryStatus — normalized lifecycle + Order mirroring", () => {
  it("advancing a manual delivery through picked_up/out_for_delivery/delivered mirrors the linked Order forward through the SAME state machine", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "driver_assigned" });
    let reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("ready"); // driver_assigned alone doesn't move the order yet

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "picked_up" });
    reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("out_for_delivery");

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "delivered" });
    reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("completed");

    const reloadedDelivery = await Delivery.findById(delivery._id);
    expect(reloadedDelivery!.status).toBe("delivered");
    expect(reloadedDelivery!.statusHistory.map((h) => h.status)).toEqual(
      expect.arrayContaining(["accepted", "driver_assigned", "picked_up", "delivered"])
    );
  });

  it("a delivery order jumping straight from accepted to out_for_delivery still correctly drives the Order through ready -> out_for_delivery (skipping driver_assigned/picked_up is a valid Delivery transition)", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "out_for_delivery" });

    const reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("out_for_delivery");
  });

  it("rejects an invalid forward jump (accepted -> delivered, skipping pickup entirely) — ignored, not applied", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "delivered" });

    const reloaded = await Delivery.findById(delivery._id);
    expect(reloaded!.status).toBe("accepted"); // unchanged
    const reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("ready"); // unchanged
  });

  it("a stale/out-of-order status arriving after a later one is ignored, never regressing the delivery", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "out_for_delivery" });
    // A delayed webhook/duplicate reporting an earlier milestone for the same delivery.
    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "driver_assigned" });

    const reloaded = await Delivery.findById(delivery._id);
    expect(reloaded!.status).toBe("out_for_delivery"); // still forward, never regressed
  });

  it("a delivery whose order has already moved on (independently cancelled) is not corrupted by a stale delivery status update", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    // Staff independently cancels the order (e.g. customer called to cancel) while the courier is
    // still nominally "accepted" in this system's own record.
    await Order.updateOne({ _id: order._id }, { $set: { status: "cancelled" } });

    // The delivery-status update must still apply to the Delivery record itself, and must never
    // throw even though the Order-side mirror transition is no longer valid.
    const updated = await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "picked_up" });
    expect(updated.status).toBe("picked_up");

    const reloadedOrder = await Order.findById(order._id);
    expect(reloadedOrder!.status).toBe("cancelled"); // left alone, not corrupted
  });
});

describe("cancelDelivery — only while a courier hasn't physically picked up yet", () => {
  it("cancels a delivery still in 'accepted'", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);

    const cancelled = await cancelDelivery(delivery.id as string, restaurant.id as string, "customer changed their mind", {
      userId: customer.id as string,
      role: "restaurant_owner",
    });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("customer changed their mind");
  });

  it("refuses to cancel a delivery already picked up", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    await updateDeliveryStatus(delivery.id as string, restaurant.id as string, { nextStatus: "picked_up" });

    await expect(
      cancelDelivery(delivery.id as string, restaurant.id as string, undefined, { userId: customer.id as string, role: "restaurant_owner" })
    ).rejects.toThrow();

    const reloaded = await Delivery.findById(delivery._id);
    expect(reloaded!.status).toBe("picked_up"); // unchanged
  });
});

describe("retryDeliveryCreation — retry guard", () => {
  it("refuses to retry a delivery that already has a providerDeliveryId (already dispatched)", async () => {
    const restaurant = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurant._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurant.id as string);
    expect(delivery.providerDeliveryId).toBeTruthy();

    await expect(retryDeliveryCreation(delivery.id as string, restaurant.id as string)).rejects.toThrow();
  });
});

describe("multi-tenant isolation", () => {
  it("a delivery cannot be read or updated through a different restaurant's id", async () => {
    const restaurantA = await deliveryReadyRestaurant();
    const restaurantB = await deliveryReadyRestaurant();
    const customer = await createTestUser("customer");
    userIds.push(customer.id as string);
    const order = await deliveryOrder(restaurantA._id, customer._id);
    const delivery = await createDeliveryForOrder(order.id as string, restaurantA.id as string);

    await expect(
      updateDeliveryStatus(delivery.id as string, restaurantB.id as string, { nextStatus: "picked_up" })
    ).rejects.toThrow();

    const found = await Delivery.findOne({ _id: delivery._id, restaurantId: restaurantB._id });
    expect(found).toBeNull();
  });
});
