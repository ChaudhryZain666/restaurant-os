import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { User } from "../models/User.js";
import { getMockMarketplaceProvider } from "../marketplaceProviders/index.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

/** Creates an active integration row directly via the model rather than the owner-facing HTTP
 *  connect endpoint — these webhook-pipeline tests care about "a restaurant has an active
 *  integration for this provider+store," not about exercising a particular connect MECHANISM (manual
 *  entry vs. Uber Eats' own OAuth flow — see restaurantMarketplaceIntegration.controller.ts's
 *  connect/start, tested separately in marketplaceOAuth.controller.test.ts). */
async function connectedIntegration(provider: "uber_eats" | "doordash" | "foodpanda", externalStoreId: string) {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);

  const integration = await RestaurantMarketplaceIntegration.create({
    restaurantId: restaurant._id,
    businessId: business._id,
    provider,
    status: "active",
    externalStoreId,
    connectedByUserId: owner._id,
    lastVerifiedAt: new Date(),
  });
  return { business, restaurant, integrationId: integration.id as string };
}

function post(provider: string, rawBody: Buffer, signatureHeader: string) {
  return request(app)
    .post(`/api/v1/webhooks/marketplace/${provider}`)
    .set("Content-Type", "application/json")
    .set("x-mock-marketplace-signature", signatureHeader)
    .send(rawBody.toString("utf-8"));
}

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    MarketplaceWebhookEvent.deleteMany({}),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("POST /webhooks/marketplace/:provider — auth", () => {
  it("rejects an unrecognized provider", async () => {
    const res = await request(app).post("/api/v1/webhooks/marketplace/grubhub").send({});
    expect(res.status).toBe(400);
  });

  it("rejects a request with no signature header", async () => {
    const res = await request(app)
      .post("/api/v1/webhooks/marketplace/uber_eats")
      .set("Content-Type", "application/json")
      .send(Buffer.from(JSON.stringify({ eventId: "e1" })));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid signature", async () => {
    const res = await post("uber_eats", Buffer.from(JSON.stringify({ eventId: "e1", eventType: "orders.notification", externalStoreId: "s1" })), "not-a-real-signature");
    expect(res.status).toBe(400);
  });

  it("accepts a validly-signed payload", async () => {
    const mock = getMockMarketplaceProvider("uber_eats");
    const payload = mock.simulateInboundOrder({
      externalOrderId: `ord_${Date.now()}`,
      externalStoreId: "unknown_store",
      externalStatus: "created",
      externalCreatedAt: new Date().toISOString(),
      orderType: "pickup",
      items: [],
      subtotalCents: 0,
      totalCents: 0,
      currency: "USD",
    });
    const { rawBody, signatureHeader } = mock.signPayload(payload);
    const res = await post("uber_eats", rawBody, signatureHeader);
    expect(res.status).toBe(200);
  });
});

describe("POST /webhooks/marketplace/:provider — idempotency", () => {
  it("processes the same eventId only once (redelivery is acknowledged, not reprocessed)", async () => {
    const mock = getMockMarketplaceProvider("uber_eats");
    const eventId = `evt_${Date.now()}`;
    const payload = { eventId, eventType: "orders.notification", externalStoreId: "some_store", externalOrderId: "some_order" };
    const { rawBody, signatureHeader } = mock.signPayload(payload);

    const first = await post("uber_eats", rawBody, signatureHeader);
    expect(first.status).toBe(200);
    const countAfterFirst = await MarketplaceWebhookEvent.countDocuments({ provider: "uber_eats", eventId });
    expect(countAfterFirst).toBe(1);

    const second = await post("uber_eats", rawBody, signatureHeader);
    expect(second.status).toBe(200);
    const countAfterSecond = await MarketplaceWebhookEvent.countDocuments({ provider: "uber_eats", eventId });
    expect(countAfterSecond).toBe(1); // still exactly one document — not reprocessed into a second one
  });
});

describe("POST /webhooks/marketplace/:provider — order events", () => {
  it("resolves the integration from the payload's store id and enqueues ingestion at elevated priority", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const { integrationId } = await connectedIntegration("doordash", "dd_store_1");

    const mock = getMockMarketplaceProvider("doordash");
    const eventId = `evt_${Date.now()}`;
    const externalOrderId = `order_${Date.now()}`;
    const payload = { eventId, eventType: "orders.notification", externalStoreId: "dd_store_1", externalOrderId };
    const { rawBody, signatureHeader } = mock.signPayload(payload);

    const res = await post("doordash", rawBody, signatureHeader);
    expect(res.status).toBe(200);
    expect(addSpy).toHaveBeenCalledWith(
      "marketplace.order_ingest",
      { provider: "doordash", integrationId, externalOrderId, eventId },
      { priority: 1 }
    );
  });

  it("acknowledges and does nothing further for an unknown/disconnected store id (never processes on behalf of the wrong restaurant)", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const mock = getMockMarketplaceProvider("foodpanda");
    const payload = { eventId: `evt_${Date.now()}`, eventType: "orders.notification", externalStoreId: "never_connected_store", externalOrderId: "o1" };
    const { rawBody, signatureHeader } = mock.signPayload(payload);

    const res = await post("foodpanda", rawBody, signatureHeader);
    expect(res.status).toBe(200);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it("a store-status event (no externalOrderId) is acknowledged without enqueueing an ingestion job", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    await connectedIntegration("uber_eats", "ue_store_status");

    const mock = getMockMarketplaceProvider("uber_eats");
    const payload = { eventId: `evt_${Date.now()}`, eventType: "store.status.changed", externalStoreId: "ue_store_status" };
    const { rawBody, signatureHeader } = mock.signPayload(payload);

    const res = await post("uber_eats", rawBody, signatureHeader);
    expect(res.status).toBe(200);
    expect(addSpy).not.toHaveBeenCalled();
  });
});
