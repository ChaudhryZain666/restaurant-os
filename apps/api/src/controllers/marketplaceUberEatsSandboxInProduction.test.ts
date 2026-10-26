import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { OAuthConnectState } from "../models/OAuthConnectState.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

/**
 * The configuration meant for Uber's sandbox validation on the production deployment:
 * NODE_ENV=production, MARKETPLACE_PROVIDER_MODE=mock (DoorDash/foodpanda unchanged),
 * UBER_EATS_PROVIDER_MODE=live, UBER_EATS_ENVIRONMENT=sandbox. Uber's signed webhooks must be
 * verified by the real adapter, while no restaurant owner can start, finish or complete an Uber Eats
 * connection. Its own file so the provider registry is built under exactly this configuration.
 */
const CLIENT_SECRET = "sandbox-in-production-test-secret";
const saved = {
  nodeEnv: env.NODE_ENV,
  global: env.MARKETPLACE_PROVIDER_MODE,
  uber: env.UBER_EATS_PROVIDER_MODE,
  environment: env.UBER_EATS_ENVIRONMENT,
  id: env.UBER_EATS_CLIENT_ID,
  secret: env.UBER_EATS_CLIENT_SECRET,
};
Object.assign(env, {
  NODE_ENV: "production",
  MARKETPLACE_PROVIDER_MODE: "mock",
  UBER_EATS_PROVIDER_MODE: "live",
  UBER_EATS_ENVIRONMENT: "sandbox",
  UBER_EATS_CLIENT_ID: "sandbox-test-client",
  UBER_EATS_CLIENT_SECRET: CLIENT_SECRET,
});

const app = createApp();
const run = Date.now();
const ids = { businesses: [] as string[], restaurants: [] as string[], users: [] as string[] };
let restaurantId = "";
let ownerToken = "";

beforeAll(async () => {
  await connectDB();
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  ids.businesses.push(business.id);
  ids.restaurants.push(restaurant.id);
  ids.users.push(owner.id as string);
  restaurantId = restaurant.id;
  ownerToken = tokenFor(owner);
});

afterAll(async () => {
  Object.assign(env, {
    NODE_ENV: saved.nodeEnv,
    MARKETPLACE_PROVIDER_MODE: saved.global,
    UBER_EATS_PROVIDER_MODE: saved.uber,
    UBER_EATS_ENVIRONMENT: saved.environment,
    UBER_EATS_CLIENT_ID: saved.id,
    UBER_EATS_CLIENT_SECRET: saved.secret,
  });
  await Promise.all([
    MarketplaceWebhookEvent.deleteMany({ provider: "uber_eats", eventId: `evt-sbx-prod-${run}` }),
    OAuthConnectState.deleteMany({ restaurantId: { $in: ids.restaurants } }),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: ids.restaurants } }),
    Restaurant.deleteMany({ _id: { $in: ids.restaurants } }),
    Business.deleteMany({ _id: { $in: ids.businesses } }),
    User.deleteMany({ _id: { $in: ids.users } }),
  ]);
  await closeTestConnections();
});

describe("production + Uber Eats sandbox: restaurant connections are closed", () => {
  it("the integrations page offers no Uber Eats connect option; DoorDash and foodpanda are unchanged (mock)", async () => {
    const res = await request(app).get(`/api/v1/restaurants/${restaurantId}/marketplace-integrations`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.capabilities.uber_eats.connect).toEqual({ mechanism: "not_available" });
    expect(res.body.data.capabilities.doordash.connect).toEqual({ mechanism: "manual_store_id" });
    expect(res.body.data.capabilities.foodpanda.connect).toEqual({ mechanism: "manual_store_id" });
  });

  it("starting an Uber Eats connection is refused (403) and mints no OAuth state", async () => {
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantId}/marketplace-integrations/uber_eats/connect/start`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
    expect(await OAuthConnectState.countDocuments({ restaurantId })).toBe(0);
  });

  it("the OAuth callback and store-picker steps are refused too (403)", async () => {
    const callback = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/callback")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code: "any-code", state: "any-state" });
    expect(callback.status).toBe(403);
    const select = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/select-store")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ stateId: "64b000000000000000000000", externalStoreId: "any-store" });
    expect(select.status).toBe(403);
  });
});

describe("production + Uber Eats sandbox: webhooks", () => {
  it("Uber's signed webhook is verified by the real adapter: 200, empty body", async () => {
    const raw = JSON.stringify({
      event_type: "orders.notification",
      event_id: `evt-sbx-prod-${run}`,
      event_time: Math.floor(Date.now() / 1000),
      meta: { resource_id: `order-${run}`, status: "pos", user_id: `unconnected-store-${run}` },
      resource_href: `https://test-api.uber.com/v2/eats/order/order-${run}`,
    });
    const res = await request(app)
      .post("/api/v1/webhooks/marketplace/uber_eats")
      .set("Content-Type", "application/json")
      .set("X-Uber-Signature", createHmac("sha256", CLIENT_SECRET).update(raw).digest("hex"))
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.text).toBe("");
  });

  it("an unsigned Uber webhook is rejected (400), not silently accepted", async () => {
    const res = await request(app).post("/api/v1/webhooks/marketplace/uber_eats").set("Content-Type", "application/json").send("{}");
    expect(res.status).toBe(400);
  });

  it("DoorDash and foodpanda webhooks stay refused (404), exactly as in mock-mode production today", async () => {
    for (const provider of ["doordash", "foodpanda"]) {
      const res = await request(app).post(`/api/v1/webhooks/marketplace/${provider}`).set("Content-Type", "application/json").send("{}");
      expect(res.status).toBe(404);
    }
  });
});
