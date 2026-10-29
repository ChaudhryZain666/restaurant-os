import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { AuditLog } from "../models/AuditLog.js";
import { Business } from "../models/Business.js";
import { MarketplaceWebhookEvent } from "../models/MarketplaceWebhookEvent.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { User } from "../models/User.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

/**
 * POST /platform/restaurants/:id/marketplace-integrations/uber_eats/link with the REAL Uber Eats
 * adapter in the production + sandbox configuration (NODE_ENV=production, UBER_EATS_PROVIDER_MODE=
 * live, UBER_EATS_ENVIRONMENT=sandbox, MARKETPLACE_PROVIDER_MODE=mock). Uber's HTTP is MOCKED per
 * URL — nothing leaves the process; the real-sandbox evidence is in docs/uber-eats-sandbox-validation.md.
 */
const CLIENT_ID = "garnishtable-test-client";
const CLIENT_SECRET = "platform-link-test-secret";
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
  UBER_EATS_CLIENT_ID: CLIENT_ID,
  UBER_EATS_CLIENT_SECRET: CLIENT_SECRET,
});

const app = createApp();
const run = Date.now();
const ids = { businesses: [] as string[], restaurants: [] as string[], users: [] as string[] };
let adminToken = "";
let ownerToken = "";
let ownerRestaurantId = "";

/** Uber's side of the conversation, per test. */
let uber: {
  posData: Record<string, unknown> | null;
  posStatus: number;
  posBody?: unknown;
  posTimeout?: boolean;
  patchStatus: number;
  tokenStatus: number;
  patches: { url: string; body: unknown }[];
};

function storeId(n: number) {
  // A valid UUID unique to this run, as Uber's store ids are.
  return `39a899b2-e44f-4eb9-b3e2-${String(run).slice(-8)}${String(n).padStart(4, "0")}`;
}

function sandboxPosData(id: string, overrides: Record<string, unknown> = {}) {
  return { store_id: id, integration_enabled: true, pos_integration_enabled: true, online_status: "online", order_manager_client_id: CLIENT_ID, auto_accept_enabled: false, ...overrides };
}

function stubUber() {
  return jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const reply = (status: number, body?: unknown) =>
      ({ status, ok: status >= 200 && status < 300, json: async () => (body === undefined ? Promise.reject(new SyntaxError("empty")) : body) }) as unknown as Response;
    if (!url.startsWith("https://sandbox-login.uber.com/") && !url.startsWith("https://test-api.uber.com/")) throw new Error(`unexpected host ${url}`);
    if (url.endsWith("/oauth/v2/token")) return uber.tokenStatus === 200 ? reply(200, { access_token: "app-token", expires_in: 2592000, scope: "eats.store eats.order" }) : reply(uber.tokenStatus, { error: "invalid_client" });
    if (url.includes("/pos_data") && method === "GET") {
      if (uber.posTimeout) return Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (uber.posBody !== undefined) return reply(200, uber.posBody);
      return uber.posStatus === 200 ? reply(200, uber.posData) : reply(uber.posStatus, { code: "error", message: `HTTP ${uber.posStatus}` });
    }
    if (url.includes("/pos_data") && method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      uber.patches.push({ url, body });
      if (uber.patchStatus !== 204) return reply(uber.patchStatus, { message: "patch failed" });
      if (uber.posData && "integration_enabled" in body) uber.posData = { ...uber.posData, integration_enabled: body.integration_enabled, pos_integration_enabled: body.integration_enabled };
      return reply(204);
    }
    throw new Error(`unexpected Uber call ${method} ${url}`);
  });
}

async function newRestaurant() {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  ids.businesses.push(business.id);
  ids.restaurants.push(restaurant.id);
  return restaurant;
}

function link(restaurantId: string, body: Record<string, unknown>, token = adminToken) {
  // Uber Eats points at the sandbox here, so the operator's test-restaurant confirmation is sent
  // unless a test deliberately leaves it out.
  return request(app)
    .post(`/api/v1/platform/restaurants/${restaurantId}/marketplace-integrations/uber_eats/link`)
    .set("Authorization", `Bearer ${token}`)
    .send({ confirmSandboxTestRestaurant: true, ...body });
}

beforeAll(async () => {
  await connectDB();
  const admin = await createTestUser("platform_admin");
  const ownerRestaurant = await newRestaurant();
  const owner = await createTestUser("restaurant_owner", ownerRestaurant._id, { businessId: ownerRestaurant.businessId });
  ids.users.push(admin.id as string, owner.id as string);
  adminToken = tokenFor(admin);
  ownerToken = tokenFor(owner);
  ownerRestaurantId = ownerRestaurant.id;
});

beforeEach(() => {
  uber = { posData: null, posStatus: 200, patchStatus: 204, tokenStatus: 200, patches: [] };
});

afterEach(() => {
  jest.restoreAllMocks();
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
    MarketplaceWebhookEvent.deleteMany({ provider: "uber_eats", eventId: { $regex: `-${run}$` } }),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: ids.restaurants } }),
    AuditLog.deleteMany({ restaurantId: { $in: ids.restaurants } }),
    Restaurant.deleteMany({ _id: { $in: ids.restaurants } }),
    Business.deleteMany({ _id: { $in: ids.businesses } }),
    User.deleteMany({ _id: { $in: ids.users } }),
  ]);
  await closeTestConnections();
});

describe("platform admin links an Uber-provisioned store", () => {
  it("verifies the store with Uber, records our restaurant id on it, and activates the integration", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(1);
    uber.posData = sandboxPosData(id);
    stubUber();

    const res = await link(restaurant.id, { externalStoreId: id });
    expect(res.status).toBe(201);
    expect(res.body.data.integration).toMatchObject({ provider: "uber_eats", status: "active", externalStoreId: id });
    expect(res.body.data.integration.encryptedCredentials).toBeUndefined();
    expect(res.body.data.uberStore).toEqual({ integrationEnabled: true, isOrderManager: true, onlineStatus: "online" });
    expect(uber.patches).toEqual([{ url: `https://test-api.uber.com/v1/eats/stores/${id}/pos_data`, body: { integrator_store_id: restaurant.id } }]);
  });

  it("once linked, a signed webhook for that store is routed to that restaurant's integration only", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(2);
    uber.posData = sandboxPosData(id);
    stubUber();
    const linked = await link(restaurant.id, { externalStoreId: id });
    expect(linked.status).toBe(201);

    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const raw = JSON.stringify({ event_type: "orders.notification", event_id: `evt-link-${run}`, event_time: 1, meta: { resource_id: `order-${run}`, status: "pos", user_id: id } });
    const hook = await request(app)
      .post("/api/v1/webhooks/marketplace/uber_eats")
      .set("Content-Type", "application/json")
      .set("X-Uber-Signature", createHmac("sha256", CLIENT_SECRET).update(raw).digest("hex"))
      .send(raw);
    expect(hook.status).toBe(200);
    expect(addSpy).toHaveBeenCalledWith(
      "marketplace.order_ingest",
      { provider: "uber_eats", integrationId: linked.body.data.integration.id, externalOrderId: `order-${run}`, eventId: `evt-link-${run}` },
      { priority: 1 }
    );
  });

  it("does not PATCH again when Uber already holds this restaurant's id", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(3);
    uber.posData = sandboxPosData(id, { integrator_store_id: restaurant.id });
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: id })).status).toBe(201);
    expect(uber.patches).toHaveLength(0);
  });

  it("switches the integration on only when asked (enableIntegration), then links", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(4);
    uber.posData = sandboxPosData(id, { integration_enabled: false, pos_integration_enabled: false });
    stubUber();

    const refused = await link(restaurant.id, { externalStoreId: id });
    expect(refused.status).toBe(409);
    expect(uber.patches).toHaveLength(0);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id, status: "active" })).toBe(0);

    const enabled = await link(restaurant.id, { externalStoreId: id, enableIntegration: true });
    expect(enabled.status).toBe(201);
    expect(uber.patches.map((p) => p.body)).toEqual([{ integration_enabled: true }, { integrator_store_id: restaurant.id }]);
  });
});

describe("retries and relinks", () => {
  it("linking the same store to the same restaurant again succeeds and keeps one active record (retry-safe)", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(20);
    uber.posData = sandboxPosData(id);
    stubUber();
    const first = await link(restaurant.id, { externalStoreId: id });
    expect(first.status).toBe(201);
    const again = await link(restaurant.id, { externalStoreId: id });
    expect(again.status).toBe(201);
    expect(again.body.data.integration.id).toBe(first.body.data.integration.id);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ provider: "uber_eats", externalStoreId: id })).toBe(1);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id, provider: "uber_eats", status: "active" })).toBe(1);
  });

  it("relinking a store whose earlier link was disconnected reactivates that record instead of failing", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(21);
    uber.posData = sandboxPosData(id);
    stubUber();
    const first = await link(restaurant.id, { externalStoreId: id });
    await RestaurantMarketplaceIntegration.updateOne({ _id: first.body.data.integration.id }, { $set: { status: "disconnected" } });

    const relinked = await link(restaurant.id, { externalStoreId: id });
    expect(relinked.status).toBe(201);
    expect(relinked.body.data.integration).toMatchObject({ id: first.body.data.integration.id, status: "active" });
  });

  it("a failed Uber write leaves no local link, and the retry then succeeds", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(22);
    uber.posData = sandboxPosData(id);
    uber.patchStatus = 500;
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: id })).status).toBe(503);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id })).toBe(0);

    uber.patchStatus = 204;
    expect((await link(restaurant.id, { externalStoreId: id })).status).toBe(201);
  });
});

describe("refusals — nothing is recorded or changed on Uber", () => {
  it("400 without the sandbox test-restaurant confirmation, before calling Uber", async () => {
    const restaurant = await newRestaurant();
    const spy = stubUber();
    const res = await request(app)
      .post(`/api/v1/platform/restaurants/${restaurant.id}/marketplace-integrations/uber_eats/link`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ externalStoreId: storeId(23) });
    expect(res.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it("never switches the integration on when we are not the order manager", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(24);
    uber.posData = sandboxPosData(id, { integration_enabled: false, pos_integration_enabled: false, order_manager_client_id: "another-app" });
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: id, enableIntegration: true })).status).toBe(409);
    expect(uber.patches).toHaveLength(0);
  });

  it("409 when another restaurant once held this store, even if that link is disconnected", async () => {
    const first = await newRestaurant();
    const second = await newRestaurant();
    const id = storeId(25);
    uber.posData = sandboxPosData(id);
    const spy = stubUber();
    const linked = await link(first.id, { externalStoreId: id });
    await RestaurantMarketplaceIntegration.updateOne({ _id: linked.body.data.integration.id }, { $set: { status: "disconnected" } });
    const calls = spy.mock.calls.length;
    uber.patches = [];

    expect((await link(second.id, { externalStoreId: id })).status).toBe(409);
    expect(spy.mock.calls.length).toBe(calls);
    expect(uber.patches).toHaveLength(0);
  });

  it("503 for Uber rate limiting, a timeout, or a malformed pos_data body — and nothing is recorded", async () => {
    const restaurant = await newRestaurant();
    stubUber();
    uber.posStatus = 429;
    expect((await link(restaurant.id, { externalStoreId: storeId(26) })).status).toBe(503);
    uber.posStatus = 200;
    uber.posTimeout = true;
    expect((await link(restaurant.id, { externalStoreId: storeId(27) })).status).toBe(503);
    uber.posTimeout = false;
    uber.posBody = { integration_enabled: true };
    expect((await link(restaurant.id, { externalStoreId: storeId(28) })).status).toBe(503);
    expect(uber.patches).toHaveLength(0);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id })).toBe(0);
  });

  it("409 when another app is the store's order manager (we could not accept or deny its orders)", async () => {
    const restaurant = await newRestaurant();
    const id = storeId(5);
    uber.posData = sandboxPosData(id, { order_manager_client_id: "another-app" });
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: id })).status).toBe(409);
    expect(uber.patches).toHaveLength(0);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id })).toBe(0);
  });

  it("409 when the store is already linked to a different restaurant (tenant isolation), before asking Uber", async () => {
    const first = await newRestaurant();
    const second = await newRestaurant();
    const id = storeId(6);
    uber.posData = sandboxPosData(id);
    const spy = stubUber();
    expect((await link(first.id, { externalStoreId: id })).status).toBe(201);
    const callsAfterFirst = spy.mock.calls.length;
    uber.patches = [];

    const res = await link(second.id, { externalStoreId: id });
    expect(res.status).toBe(409);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    expect(uber.patches).toHaveLength(0);
    const owner = await RestaurantMarketplaceIntegration.findOne({ provider: "uber_eats", externalStoreId: id, status: "active" });
    expect(owner?.restaurantId?.toString()).toBe(first.id);
  });

  it("404 when Uber doesn't show the store to our app", async () => {
    const restaurant = await newRestaurant();
    uber.posStatus = 404;
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: storeId(7) })).status).toBe(404);
  });

  it("503 when Uber refuses our credentials", async () => {
    const restaurant = await newRestaurant();
    uber.tokenStatus = 401;
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: storeId(8) })).status).toBe(503);
    expect(await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id })).toBe(0);
  });

  it("503 when Uber's answer is for a different store", async () => {
    const restaurant = await newRestaurant();
    uber.posData = sandboxPosData(storeId(99));
    stubUber();
    expect((await link(restaurant.id, { externalStoreId: storeId(9) })).status).toBe(503);
  });

  it("400 for a store id that isn't a UUID, 404 for an unknown restaurant", async () => {
    const restaurant = await newRestaurant();
    const spy = stubUber();
    expect((await link(restaurant.id, { externalStoreId: "not-a-uuid" })).status).toBe(400);
    expect((await link("6a0000000000000000000000", { externalStoreId: storeId(10) })).status).toBe(404);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a restaurant owner cannot use this platform-only action (403), even for their own restaurant", async () => {
    const spy = stubUber();
    expect((await link(ownerRestaurantId, { externalStoreId: storeId(11) }, ownerToken)).status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });
});
