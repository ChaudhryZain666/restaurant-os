import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { User } from "../models/User.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

/**
 * POST /api/v1/webhooks/marketplace/uber_eats with the REAL UberEatsProvider (live mode, sandbox
 * hosts) — Uber's documented orders.notification payload, signed the way Uber signs it
 * (X-Uber-Signature = HMAC-SHA256 of the raw body with the app's client secret). No Uber network call
 * is made: the webhook path only verifies, records and enqueues. Its own file so the provider
 * registry is built fresh in live mode rather than reusing another suite's mock instance.
 */
const CLIENT_SECRET = "uber-eats-webhook-test-secret";
const saved = {
  mode: env.MARKETPLACE_PROVIDER_MODE,
  environment: env.UBER_EATS_ENVIRONMENT,
  id: env.UBER_EATS_CLIENT_ID,
  secret: env.UBER_EATS_CLIENT_SECRET,
};
Object.assign(env, { MARKETPLACE_PROVIDER_MODE: "live", UBER_EATS_ENVIRONMENT: "sandbox", UBER_EATS_CLIENT_ID: "uber-eats-test-client", UBER_EATS_CLIENT_SECRET: CLIENT_SECRET });

const app = createApp();
const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const run = Date.now();

function uberEvent(eventType: string, storeId: string, orderId: string, eventId = `evt-${eventType}-${storeId}-${orderId}`) {
  // Shape of Uber's documented webhooks.orders-notification example.
  return {
    event_type: eventType,
    event_id: eventId,
    event_time: Math.floor(Date.now() / 1000),
    meta: { resource_id: orderId, status: "pos", user_id: storeId },
    resource_href: `https://test-api.uber.com/v2/eats/order/${orderId}`,
  };
}

function postSigned(payload: unknown, secret = CLIENT_SECRET) {
  const raw = JSON.stringify(payload);
  return request(app)
    .post("/api/v1/webhooks/marketplace/uber_eats")
    .set("Content-Type", "application/json")
    .set("X-Uber-Signature", createHmac("sha256", secret).update(raw).digest("hex"))
    .send(raw);
}

async function connectedStore(externalStoreId: string) {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);
  const integration = await RestaurantMarketplaceIntegration.create({
    restaurantId: restaurant._id,
    businessId: business._id,
    provider: "uber_eats",
    status: "active",
    externalStoreId,
    connectedByUserId: owner._id,
    lastVerifiedAt: new Date(),
  });
  return integration.id as string;
}

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  Object.assign(env, { MARKETPLACE_PROVIDER_MODE: saved.mode, UBER_EATS_ENVIRONMENT: saved.environment, UBER_EATS_CLIENT_ID: saved.id, UBER_EATS_CLIENT_SECRET: saved.secret });
  await Promise.all([
    MarketplaceWebhookEvent.deleteMany({ provider: "uber_eats", eventId: { $regex: `^evt-.*-${run}` } }),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("Uber Eats webhook — real adapter, Uber's documented payload", () => {
  it("a new order for a connected store: 200 with an empty body, ingestion enqueued for that store's integration", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const storeId = `ue-store-${run}`;
    const integrationId = await connectedStore(storeId);
    const payload = uberEvent("orders.notification", storeId, `order-${run}`, `evt-new-${run}`);

    const res = await postSigned(payload);
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
    expect(addSpy).toHaveBeenCalledWith(
      "marketplace.order_ingest",
      { provider: "uber_eats", integrationId, externalOrderId: `order-${run}`, eventId: `evt-new-${run}` },
      { priority: 1 }
    );
  });

  it("a redelivered event is acknowledged again but enqueued and recorded only once", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const storeId = `ue-store-dup-${run}`;
    await connectedStore(storeId);
    const payload = uberEvent("orders.notification", storeId, `order-dup-${run}`, `evt-dup-${run}`);

    expect((await postSigned(payload)).status).toBe(200);
    expect((await postSigned(payload)).status).toBe(200);
    expect(addSpy).toHaveBeenCalledTimes(1);
    expect(await MarketplaceWebhookEvent.countDocuments({ provider: "uber_eats", eventId: `evt-dup-${run}` })).toBe(1);
  });

  it("a cancellation for a connected store is acknowledged and never ingested as a new order", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const storeId = `ue-store-cancel-${run}`;
    await connectedStore(storeId);

    const res = await postSigned(uberEvent("orders.cancel", storeId, `order-cancel-${run}`, `evt-cancel-${run}`));
    expect(res.status).toBe(200);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("an event for a store no restaurant has connected (e.g. Uber's own test events): 200, ignored", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const res = await postSigned(uberEvent("orders.notification", `unconnected-${run}`, `order-x-${run}`, `evt-unknown-${run}`));
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("rejects a payload signed with any other secret, and one with no signature", async () => {
    const payload = uberEvent("orders.notification", `ue-store-${run}`, `order-forged-${run}`, `evt-forged-${run}`);
    expect((await postSigned(payload, "someone-elses-secret")).status).toBe(400);
    const unsigned = await request(app).post("/api/v1/webhooks/marketplace/uber_eats").set("Content-Type", "application/json").send(JSON.stringify(payload));
    expect(unsigned.status).toBe(400);
    expect(await MarketplaceWebhookEvent.countDocuments({ provider: "uber_eats", eventId: `evt-forged-${run}` })).toBe(0);
  });
});
