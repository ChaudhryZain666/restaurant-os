import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { OAuthConnectState } from "../models/OAuthConnectState.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";
import type { EncryptedBlob } from "../utils/credentialEncryption.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function ownedRestaurant() {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);
  return { business, restaurant, owner, ownerToken: tokenFor(owner) };
}

/** Starts a real Uber Eats connect flow and pulls `code`/`state` back out of the mock-mode authorize
 *  URL, exactly like MarketplaceOAuthCallbackPage.tsx will do from window.location.search. */
async function startConnect(restaurantId: string, ownerToken: string) {
  const res = await request(app)
    .post(`/api/v1/restaurants/${restaurantId}/marketplace-integrations/uber_eats/connect/start`)
    .set("Authorization", `Bearer ${ownerToken}`);
  const url = new URL(res.body.data.url);
  return { code: url.searchParams.get("code")!, state: url.searchParams.get("state")! };
}

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Promise.all([
    OAuthConnectState.deleteMany({ restaurantId: { $in: restaurantIds } }),
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("POST /restaurants/:restaurantId/marketplace-integrations/:provider/connect/start", () => {
  it("mints a state and returns a real authorize URL pointing at the admin callback route", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/uber_eats/connect/start`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    const url = new URL(res.body.data.url);
    expect(url.pathname).toBe("/marketplace/oauth-callback");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("rejects doordash — its resolved capability is not oauth_redirect", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/doordash/connect/start`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("rejects foodpanda — its resolved capability is not oauth_redirect", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/foodpanda/connect/start`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("staff without restaurant.marketplace.manage cannot start a connect flow", async () => {
    const { restaurant } = await ownedRestaurant();
    const staff = await createTestUser("restaurant_staff", restaurant._id, { businessId: restaurant.businessId });
    userIds.push(staff.id as string);
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/uber_eats/connect/start`)
      .set("Authorization", `Bearer ${tokenFor(staff)}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /marketplace-oauth/uber_eats/callback", () => {
  it("completes the full flow end to end: start -> callback -> active integration with the discovered store id", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const { code, state } = await startConnect(restaurant.id, ownerToken);

    const res = await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send({ code, state });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("connected");
    expect(res.body.data.integration.provider).toBe("uber_eats");
    expect(res.body.data.integration.status).toBe("active");
    expect(res.body.data.integration.externalStoreId).toMatch(/^mock_store_/);
  });

  it("never returns encryptedCredentials in the callback response, even though the field is now populated on the schema", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const { code, state } = await startConnect(restaurant.id, ownerToken);
    const res = await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send({ code, state });
    expect(res.body.data.integration.encryptedCredentials).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/mock_access_token/);

    const stored = await RestaurantMarketplaceIntegration.findOne({ restaurantId: restaurant.id, provider: "uber_eats" });
    const blob = stored!.encryptedCredentials as EncryptedBlob;
    expect(blob.ciphertext).toBeTruthy();
    expect(stored!.credentialFingerprint).toBeTruthy();
  });

  it("returns status denied when the owner declines on Uber's consent screen (error param, no code)", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const { state } = await startConnect(restaurant.id, ownerToken);
    const res = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/callback")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ state, error: "access_denied" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("denied");

    const stored = await RestaurantMarketplaceIntegration.findOne({ restaurantId: restaurant.id, provider: "uber_eats" });
    expect(stored).toBeNull();
  });

  it("returns status expired for an unknown/garbage state value", async () => {
    const { ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/callback")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ code: "mock_auth_code", state: "not-a-real-state-value" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("expired");
  });

  it("returns status expired when the same state is replayed a second time", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const { code, state } = await startConnect(restaurant.id, ownerToken);
    const first = await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send({ code, state });
    expect(first.body.data.status).toBe("connected");

    const second = await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send({ code, state });
    expect(second.body.data.status).toBe("expired");
  });

  it("403s when a different user tries to complete a connection they didn't start (cross-tenant/CSRF protection)", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const { code, state } = await startConnect(restaurant.id, ownerToken);
    const { ownerToken: otherOwnerToken } = await ownedRestaurant();

    const res = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/callback")
      .set("Authorization", `Bearer ${otherOwnerToken}`)
      .send({ code, state });
    expect(res.status).toBe(403);

    // The state is consumed (single-use) even though the userId check rejected it — it can never be
    // replayed by the legitimate owner either, which is correct: a state a third party got hold of
    // and tried first is burned, exactly like a used one-time password would be.
    const stored = await RestaurantMarketplaceIntegration.findOne({ restaurantId: restaurant.id, provider: "uber_eats" });
    expect(stored).toBeNull();
  });

  it("reconnecting disconnects the previously active Uber Eats integration, never leaving two active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const first = await startConnect(restaurant.id, ownerToken);
    await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send(first);

    const second = await startConnect(restaurant.id, ownerToken);
    await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").set("Authorization", `Bearer ${ownerToken}`).send(second);

    const activeCount = await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant.id, provider: "uber_eats", status: "active" });
    expect(activeCount).toBe(1);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/v1/marketplace-oauth/uber_eats/callback").send({ code: "mock_auth_code", state: "whatever" });
    expect(res.status).toBe(401);
  });
});

describe("POST /marketplace-oauth/uber_eats/select-store", () => {
  it("finalizes a multi-store pick against a seeded pending selection, scoped to the user who owns it", async () => {
    const { restaurant, owner, ownerToken } = await ownedRestaurant();
    const state = await OAuthConnectState.create({
      tokenHash: "test-hash-for-select-store-case",
      provider: "uber_eats",
      restaurantId: restaurant._id,
      businessId: restaurant.businessId,
      userId: owner._id,
      redirectUri: "https://admin.example.com/marketplace/oauth-callback",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      pendingCandidateStores: [
        { externalStoreId: "store_downtown", displayName: "Downtown" },
        { externalStoreId: "store_uptown", displayName: "Uptown" },
      ],
    });

    const res = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/select-store")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ stateId: state.id, externalStoreId: "store_uptown" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("connected");
    expect(res.body.data.integration.externalStoreId).toBe("store_uptown");
  });

  it("404s for a different user trying to finalize someone else's pending selection", async () => {
    const { restaurant, owner } = await ownedRestaurant();
    const { ownerToken: otherOwnerToken } = await ownedRestaurant();
    const state = await OAuthConnectState.create({
      tokenHash: "test-hash-for-select-store-cross-user",
      provider: "uber_eats",
      restaurantId: restaurant._id,
      businessId: restaurant.businessId,
      userId: owner._id,
      redirectUri: "https://admin.example.com/marketplace/oauth-callback",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      pendingCandidateStores: [{ externalStoreId: "store_a", displayName: "A" }],
    });

    const res = await request(app)
      .post("/api/v1/marketplace-oauth/uber_eats/select-store")
      .set("Authorization", `Bearer ${otherOwnerToken}`)
      .send({ stateId: state.id, externalStoreId: "store_a" });
    expect(res.status).toBe(404);
  });
});
