import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantDeliveryProviderAccount } from "../models/RestaurantDeliveryProviderAccount.js";
import { User } from "../models/User.js";
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
