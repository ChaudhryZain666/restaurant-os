import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Delivery } from "../models/Delivery.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestOrder,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

const restaurantIds: string[] = [];
const userIds: string[] = [];

async function deliveryReadyRestaurant() {
  const restaurant = await createTestRestaurant({ latitude: 24.8607, longitude: 67.0011, address: "1 Test St", city: "Karachi" });
  restaurantIds.push(restaurant.id);
  const owner = await createTestUser("restaurant_owner", restaurant._id);
  const staff = await createTestUser("restaurant_staff", restaurant._id);
  const customer = await createTestUser("customer");
  userIds.push(owner.id as string, staff.id as string, customer.id as string);
  return { restaurant, ownerToken: tokenFor(owner), staffToken: tokenFor(staff), customer };
}

async function readyDeliveryOrder(restaurantId: mongoose.Types.ObjectId, customerId: mongoose.Types.ObjectId) {
  return createTestOrder(restaurantId, customerId, {
    orderType: "delivery",
    status: "ready",
    statusHistory: [{ status: "pending", at: new Date() }, { status: "ready", at: new Date() }],
    deliveryAddress: { line1: "42 Customer Lane", city: "Karachi", latitude: 24.87, longitude: 67.02 },
  });
}

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Promise.all([
    Delivery.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    RestaurantDeliveryProviderAccount.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("GET /restaurants/:restaurantId/orders/:orderId/delivery", () => {
  it("returns null (not 404) when the order has no delivery yet", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.delivery).toBeNull();
  });

  it("staff without restaurant.orders.manage is forbidden (a plain customer token)", async () => {
    const { restaurant, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    const customerToken = tokenFor(customer);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery`)
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST .../delivery/manual-status", () => {
  it("advances a manual delivery's status and mirrors the Order forward", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    const delivery = await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "accepted",
      providerDeliveryId: `manual_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/manual-status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "out_for_delivery", courierName: "Ali" });

    expect(res.status).toBe(200);
    expect(res.body.data.delivery.status).toBe("out_for_delivery");
    expect(res.body.data.delivery.courierName).toBe("Ali");

    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.status).toBe("out_for_delivery");
    void delivery;
  });

  it("refuses a manual-status action on a third-party-dispatched delivery", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "uber_direct",
      status: "accepted",
      providerDeliveryId: `uber_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/manual-status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "out_for_delivery" });

    expect(res.status).toBe(400);
  });

  it("rejects a status value outside the manual-reachable subset", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "accepted",
      providerDeliveryId: `manual_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/manual-status`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ status: "cancelled" }); // not in updateManualDeliverySchema's enum — cancel has its own endpoint

    expect(res.status).toBe(400);
  });
});

describe("cross-tenant isolation", () => {
  it("restaurant B staff querying restaurant A's order id (under restaurant B's own URL) finds nothing, never A's delivery", async () => {
    const a = await deliveryReadyRestaurant();
    const b = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(a.restaurant._id, a.customer._id);
    await Delivery.create({
      restaurantId: a.restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "accepted",
      providerDeliveryId: `manual_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    // B's own staff token legitimately passes requireTenantMatch for B's own restaurantId — the
    // real guard here is the Delivery lookup itself being scoped to {orderId, restaurantId}, which
    // must never resolve across tenants just because an order id happens to be guessed correctly.
    const res = await request(app)
      .get(`/api/v1/restaurants/${b.restaurant.id}/orders/${order.id}/delivery`)
      .set("Authorization", `Bearer ${b.staffToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.delivery).toBeNull();
  });

  it("restaurant B staff cannot even reach restaurant A's delivery routes directly (tenant-match middleware)", async () => {
    const a = await deliveryReadyRestaurant();
    const b = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(a.restaurant._id, a.customer._id);

    const res = await request(app)
      .get(`/api/v1/restaurants/${a.restaurant.id}/orders/${order.id}/delivery`)
      .set("Authorization", `Bearer ${b.staffToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST .../delivery/cancel and .../delivery/retry", () => {
  it("cancels a not-yet-picked-up delivery", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "accepted",
      providerDeliveryId: `manual_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/cancel`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ reason: "restaurant closed early" });

    expect(res.status).toBe(200);
    expect(res.body.data.delivery.status).toBe("cancelled");
  });

  it("retry refuses a delivery that's already dispatched", async () => {
    const { restaurant, staffToken, customer } = await deliveryReadyRestaurant();
    const order = await readyDeliveryOrder(restaurant._id, customer._id);
    await Delivery.create({
      restaurantId: restaurant._id,
      orderId: order._id,
      orderNumber: order.orderNumber,
      provider: "manual",
      status: "accepted",
      providerDeliveryId: `manual_${new mongoose.Types.ObjectId().toString()}`,
      idempotencyKey: `delivery_create_${order.id}`,
    });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/orders/${order.id}/delivery/retry`)
      .set("Authorization", `Bearer ${staffToken}`);

    expect(res.status).toBe(409);
  });
});
