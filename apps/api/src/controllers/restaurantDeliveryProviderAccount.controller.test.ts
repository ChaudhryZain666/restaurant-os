import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { User } from "../models/User.js";
import { decryptCredentials, type EncryptedBlob } from "../utils/credentialEncryption.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { Agency } from "../models/Agency.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const agencyIds: string[] = [];

async function ownedRestaurant(overrides: Record<string, unknown> = {}) {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id, ...overrides });
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  const staff = await createTestUser("restaurant_staff", restaurant._id, { businessId: business._id });
  businessIds.push(business.id);
  restaurantIds.push(restaurant.id);
  userIds.push(owner.id as string, staff.id as string);
  return { business, restaurant, ownerToken: tokenFor(owner), staffToken: tokenFor(staff) };
}

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({ status, ok, json: async () => body } as unknown as Response);
}

const validCredentials = { clientId: "client_abc", clientSecret: "secret_abc", customerId: "cus_abc123", webhookSigningSecret: "whsec_abc123" };

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    RestaurantDeliveryProviderAccount.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
  ]);
  await closeTestConnections();
});

describe("GET /restaurants/:restaurantId/delivery-account", () => {
  it("returns null when the restaurant has no connected account", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.account).toBeNull();
  });

  it("staff without restaurant.payments.manage is forbidden", async () => {
    const { restaurant, staffToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("an agency member managing this business is ALSO forbidden — courier credentials stay owner-only, same boundary as restaurant.payments.manage", async () => {
    const { restaurant, business } = await ownedRestaurant();
    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    const agencyOwnerUser = await createTestUser("agency_member");
    userIds.push(agencyOwnerUser.id as string);
    await createTestAgencyMembership(agency._id, agencyOwnerUser._id, { role: "agency_owner", businessIds: [business._id] });
    const agencyToken = tokenFor(agencyOwnerUser, [{ agencyId: agency.id, role: "agency_owner" }]);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${agencyToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /restaurants/:restaurantId/delivery-account — Uber Direct (BYOC only)", () => {
  it("connects and activates when credentials verify", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { access_token: "tok_verify", expires_in: 2_592_000 });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(validCredentials);

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("active");
    expect(res.body.data.account.provider).toBe("uber_direct");
    expect(res.body.data.webhookUrl).toEqual(expect.stringContaining(`/webhooks/deliveries/uber_direct/${res.body.data.account.id}`));
    expect(res.body.data.account.encryptedCredentials).toBeUndefined();
  });

  it("stores the account as invalid, never active, when verification fails", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(401, { error: "invalid_client" }, false);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(validCredentials);

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("invalid");
  });

  it("reconnecting disconnects the previously active account, never leaving two active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { access_token: "tok_1", expires_in: 2_592_000 });
    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(validCredentials);
    expect(first.body.data.account.status).toBe("active");

    mockFetchOnce(200, { access_token: "tok_2", expires_in: 2_592_000 });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ ...validCredentials, customerId: "cus_new456" });
    expect(second.body.data.account.status).toBe("active");

    const activeCount = await RestaurantDeliveryProviderAccount.countDocuments({ restaurantId: restaurant._id, status: "active" });
    expect(activeCount).toBe(1);
  });

  it("rejects malformed credentials (missing required field)", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ clientId: "client_abc" });
    expect(res.status).toBe(400);
  });
});

describe("POST /restaurants/:restaurantId/delivery-account/disconnect", () => {
  it("disconnects the active account, and GET reflects no connected account afterward", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { access_token: "tok_1", expires_in: 2_592_000 });
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send(validCredentials);

    const disconnect = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.data.account.status).toBe("disconnected");

    const after = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(after.body.data.account).toBeNull();
  });

  it("404s when there is no account to disconnect", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/delivery-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});

// Phase 89 (U2) — connect first (to learn the webhook URL Uber needs), add the signing secret after,
// on the same account so the URL registered with Uber never changes.
describe("Phase 89 — webhook signing secret added after connecting", () => {
  const withoutSecret = { clientId: validCredentials.clientId, clientSecret: validCredentials.clientSecret, customerId: validCredentials.customerId };

  async function connectWithoutSecret() {
    const ctx = await ownedRestaurant();
    mockFetchOnce(200, { access_token: "tok_verify", expires_in: 2_592_000 });
    const res = await request(app)
      .post(`/api/v1/restaurants/${ctx.restaurant.id}/delivery-account`)
      .set("Authorization", `Bearer ${ctx.ownerToken}`)
      .send(withoutSecret);
    return { ...ctx, res };
  }

  it("connects without a signing secret, shows the webhook URL, and says the secret is still missing", async () => {
    const { res } = await connectWithoutSecret();
    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("active");
    expect(res.body.data.account.webhookSecretConfigured).toBe(false);
    expect(res.body.data.webhookUrl).toEqual(expect.stringContaining(`/webhooks/deliveries/uber_direct/${res.body.data.account.id}`));
  });

  it("adds the secret in place: same account id and URL, other credentials untouched, secret never returned", async () => {
    const { restaurant, ownerToken, res: connected } = await connectWithoutSecret();
    const accountId = connected.body.data.account.id;

    const res = await request(app)
      .put(`/api/v1/restaurants/${restaurant.id}/delivery-account/webhook-signing-secret`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ webhookSigningSecret: "whsec_added_later" });

    expect(res.status).toBe(200);
    expect(res.body.data.account.id).toBe(accountId);
    expect(res.body.data.account.webhookSecretConfigured).toBe(true);
    expect(res.body.data.webhookUrl).toBe(connected.body.data.webhookUrl);
    expect(JSON.stringify(res.body)).not.toContain("whsec_added_later");

    const stored = await RestaurantDeliveryProviderAccount.findById(accountId);
    expect(decryptCredentials(stored!.encryptedCredentials as EncryptedBlob)).toEqual({ ...withoutSecret, webhookSigningSecret: "whsec_added_later" });
    expect(await RestaurantDeliveryProviderAccount.countDocuments({ restaurantId: restaurant._id })).toBe(1);
  });

  it("only the owner can set it, it can't be blank, and there must be an active account", async () => {
    const { restaurant, staffToken, ownerToken } = await connectWithoutSecret();
    const path = `/api/v1/restaurants/${restaurant.id}/delivery-account/webhook-signing-secret`;
    expect((await request(app).put(path).set("Authorization", `Bearer ${staffToken}`).send({ webhookSigningSecret: "x" })).status).toBe(403);
    expect((await request(app).put(path).set("Authorization", `Bearer ${ownerToken}`).send({ webhookSigningSecret: "   " })).status).toBe(400);

    const other = await ownedRestaurant();
    const none = await request(app)
      .put(`/api/v1/restaurants/${other.restaurant.id}/delivery-account/webhook-signing-secret`)
      .set("Authorization", `Bearer ${other.ownerToken}`)
      .send({ webhookSigningSecret: "whsec_x" });
    expect(none.status).toBe(404);
  });
});
