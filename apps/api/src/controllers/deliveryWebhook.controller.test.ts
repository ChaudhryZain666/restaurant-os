import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Delivery } from "../models/Delivery.js";
import { DeliveryWebhookEvent } from "../models/DeliveryWebhookEvent.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { User } from "../models/User.js";
import { encryptCredentials } from "../utils/credentialEncryption.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const app = createApp();

const restaurantIds: string[] = [];
const userIds: string[] = [];

const WEBHOOK_SECRET = "whsec_test_delivery_secret";

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Promise.all([
    Delivery.deleteMany({ restaurantId: { $in: restaurantIds } }),
    DeliveryWebhookEvent.deleteMany({}),
    Order.deleteMany({ restaurantId: { $in: restaurantIds } }),
    RestaurantDeliveryProviderAccount.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

async function accountAndDelivery() {
  const restaurant = await createTestRestaurant();
  restaurantIds.push(restaurant.id);
  const customer = await createTestUser("customer");
  userIds.push(customer.id as string);
  const order = await createTestOrder(restaurant._id, customer._id, {
    orderType: "delivery",
    status: "ready",
    deliveryAddress: { line1: "1 Test St", city: "Karachi", latitude: 24.87, longitude: 67.02 },
  });

  const account = await RestaurantDeliveryProviderAccount.create({
    restaurantId: restaurant._id,
    businessId: new mongoose.Types.ObjectId(),
    provider: "uber_direct",
    status: "active",
    encryptedCredentials: encryptCredentials({
      clientId: "client_x",
      clientSecret: "secret_x",
      customerId: "cus_x",
      webhookSigningSecret: WEBHOOK_SECRET,
    }),
    connectedByUserId: customer._id,
  });

  const providerDeliveryId = `uber_${new mongoose.Types.ObjectId().toString()}`;
  const delivery = await Delivery.create({
    restaurantId: restaurant._id,
    orderId: order._id,
    orderNumber: order.orderNumber,
    provider: "uber_direct",
    status: "accepted",
    providerDeliveryId,
    idempotencyKey: `delivery_create_${order.id}`,
  });

  return { restaurant, order, account, delivery, providerDeliveryId };
}

function signedWebhook(providerDeliveryId: string, status: string, extra: Record<string, unknown> = {}) {
  const payload = {
    id: `evt_${new mongoose.Types.ObjectId().toString()}`,
    kind: "event.delivery_status",
    delivery_id: providerDeliveryId,
    status,
    data: extra,
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
  return { rawBody, signature, eventId: payload.id };
}

describe("POST /webhooks/deliveries/:provider/:accountId — Uber Direct signature verification", () => {
  it("accepts a validly-signed event and applies the delivery status transition", async () => {
    const { account, delivery } = await accountAndDelivery();
    const { rawBody, signature } = signedWebhook(delivery.providerDeliveryId!, "pickup_complete");

    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(200);
    const stored = await Delivery.findById(delivery._id);
    expect(stored!.status).toBe("picked_up");
  });

  it("rejects a request with no signature header", async () => {
    const { account, delivery } = await accountAndDelivery();
    const { rawBody } = signedWebhook(delivery.providerDeliveryId!, "pickup_complete");

    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(400);
    const stored = await Delivery.findById(delivery._id);
    expect(stored!.status).toBe("accepted");
  });

  it("rejects a tampered signature", async () => {
    const { account, delivery } = await accountAndDelivery();
    const { rawBody } = signedWebhook(delivery.providerDeliveryId!, "pickup_complete");

    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", "0".repeat(64))
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(400);
    const stored = await Delivery.findById(delivery._id);
    expect(stored!.status).toBe("accepted");
  });

  it("rejects a webhook signed with a DIFFERENT restaurant's own signing secret", async () => {
    const { account, delivery } = await accountAndDelivery();
    const wrongSignature = createHmac("sha256", "some_other_restaurants_secret")
      .update(JSON.stringify({ id: "evt_x", kind: "event.delivery_status", delivery_id: delivery.providerDeliveryId, status: "pickup_complete", data: {} }))
      .digest("hex");

    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", wrongSignature)
      .send(JSON.stringify({ id: "evt_x", kind: "event.delivery_status", delivery_id: delivery.providerDeliveryId, status: "pickup_complete", data: {} }));

    expect(res.status).toBe(400);
  });

  it("manual provider is not a valid webhook target — it has no external callbacks at all", async () => {
    const { account } = await accountAndDelivery();
    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/manual/${account.id}`)
      .set("Content-Type", "application/json")
      .send("{}");
    expect(res.status).toBe(400);
  });
});

describe("webhook idempotency and duplicate protection", () => {
  it("processing the same event twice does not double-apply the transition or create a second event record", async () => {
    const { account, delivery } = await accountAndDelivery();
    const { rawBody, signature, eventId } = signedWebhook(delivery.providerDeliveryId!, "pickup_complete");

    const first = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));
    const second = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200); // still acknowledged — a provider retry must not error out

    const eventCount = await DeliveryWebhookEvent.countDocuments({ provider: "uber_direct", eventId });
    expect(eventCount).toBe(1);
  });

  it("an event for an unrecognized providerDeliveryId is acknowledged but changes nothing", async () => {
    const { account } = await accountAndDelivery();
    const { rawBody, signature } = signedWebhook(`uber_${new mongoose.Types.ObjectId().toString()}`, "pickup_complete");

    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));

    expect(res.status).toBe(200);
  });

  it("an event only ever affects the one delivery its delivery_id matches, never another restaurant's delivery", async () => {
    const first = await accountAndDelivery();
    const second = await accountAndDelivery();
    const { rawBody, signature } = signedWebhook(first.delivery.providerDeliveryId!, "pickup_complete");

    await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${first.account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));

    const storedFirst = await Delivery.findById(first.delivery._id);
    const storedSecond = await Delivery.findById(second.delivery._id);
    expect(storedFirst!.status).toBe("picked_up");
    expect(storedSecond!.status).toBe("accepted"); // untouched
  });

  it("a stale/out-of-order status is acknowledged but does not regress the delivery", async () => {
    const { account, delivery } = await accountAndDelivery();
    const forward = signedWebhook(delivery.providerDeliveryId!, "dropoff"); // -> out_for_delivery
    await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", forward.signature)
      .send(forward.rawBody.toString("utf-8"));

    const stale = signedWebhook(delivery.providerDeliveryId!, "pickup"); // -> driver_assigned, earlier than out_for_delivery
    const res = await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", stale.signature)
      .send(stale.rawBody.toString("utf-8"));

    expect(res.status).toBe(200); // acknowledged, never a hard error for the provider
    const stored = await Delivery.findById(delivery._id);
    expect(stored!.status).toBe("out_for_delivery"); // unchanged, not regressed
  });

  it("also mirrors the linked Order forward (ready -> out_for_delivery) via the webhook path, same as a staff action", async () => {
    const { account, delivery, order } = await accountAndDelivery();
    const { rawBody, signature } = signedWebhook(delivery.providerDeliveryId!, "dropoff");

    await request(app)
      .post(`/api/v1/webhooks/deliveries/uber_direct/${account.id}`)
      .set("Content-Type", "application/json")
      .set("x-uber-signature", signature)
      .send(rawBody.toString("utf-8"));

    const storedOrder = await Order.findById(order._id);
    expect(storedOrder!.status).toBe("out_for_delivery");
  });
});
