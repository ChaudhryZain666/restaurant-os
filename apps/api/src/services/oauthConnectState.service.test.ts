import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { OAuthConnectState } from "../models/OAuthConnectState.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser } from "../test-utils/fixtures.js";
import { consumeOAuthConnectState, finalizePendingStoreSelection, issueOAuthConnectState, savePendingStoreSelection } from "./oauthConnectState.service.js";

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function binding() {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string);
  return {
    provider: "uber_eats" as const,
    restaurantId: restaurant._id,
    businessId: business._id,
    userId: owner._id,
    redirectUri: "https://admin.example.com/marketplace/oauth-callback",
  };
}

beforeAll(async () => {
  await connectDB();
});

afterAll(async () => {
  await Promise.all([
    OAuthConnectState.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("oauthConnectState.service", () => {
  it("issues a state whose raw value round-trips through consume", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    const consumed = await consumeOAuthConnectState(raw, "uber_eats");
    expect(consumed).not.toBeNull();
    expect(consumed!.userId.toString()).toBe(b.userId.toString());
    expect(consumed!.restaurantId.toString()).toBe(b.restaurantId.toString());
  });

  it("never persists the raw value — only its hash is stored", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    const stored = await OAuthConnectState.findOne({ restaurantId: b.restaurantId }).sort({ createdAt: -1 });
    expect(stored!.tokenHash).not.toBe(raw);
    expect(JSON.stringify(stored!.toJSON())).not.toContain(raw);
  });

  it("rejects an unknown state value", async () => {
    const consumed = await consumeOAuthConnectState("not-a-real-token", "uber_eats");
    expect(consumed).toBeNull();
  });

  it("rejects a state minted for a different provider", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    // OAuthConnectState only accepts "uber_eats" today, so any other provider string is a mismatch.
    const consumed = await consumeOAuthConnectState(raw, "doordash");
    expect(consumed).toBeNull();
  });

  it("rejects an expired state", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    await OAuthConnectState.updateOne({ restaurantId: b.restaurantId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const consumed = await consumeOAuthConnectState(raw, "uber_eats");
    expect(consumed).toBeNull();
  });

  it("rejects a replayed (already-consumed) state — the atomic claim is single-use", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    const first = await consumeOAuthConnectState(raw, "uber_eats");
    expect(first).not.toBeNull();
    const second = await consumeOAuthConnectState(raw, "uber_eats");
    expect(second).toBeNull();
  });

  it("the multi-store picker only finalizes for the same user who consumed the state", async () => {
    const b = await binding();
    const { raw } = await issueOAuthConnectState(b);
    const consumed = await consumeOAuthConnectState(raw, "uber_eats");
    const stateId = consumed!.id;
    await savePendingStoreSelection(stateId, [
      { externalStoreId: "store_a", displayName: "Downtown" },
      { externalStoreId: "store_b", displayName: "Uptown" },
    ]);

    const wrongUser = await finalizePendingStoreSelection(stateId, "store_a", "000000000000000000000000");
    expect(wrongUser).toBeNull();

    const rightUser = await finalizePendingStoreSelection(stateId, "store_a", b.userId.toString());
    expect(rightUser).toEqual({
      restaurantId: b.restaurantId,
      businessId: b.businessId,
      externalStoreId: "store_a",
      encryptedCredentials: undefined,
      credentialFingerprint: undefined,
    });

    const unknownStore = await finalizePendingStoreSelection(stateId, "store_z", b.userId.toString());
    expect(unknownStore).toBeNull();
  });
});
