import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];

async function ownedRestaurant() {
  const business = await createTestBusiness();
  const restaurant = await createTestRestaurant({ businessId: business._id });
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

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    RestaurantPaymentAccount.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

describe("GET /restaurants/:restaurantId/payment-account", () => {
  it("returns null when the restaurant has no connected account", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.account).toBeNull();
    expect(res.body.data.webhookUrl).toBeNull();
  });

  it("staff without restaurant.payments.manage is forbidden", async () => {
    const { restaurant, staffToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /restaurants/:restaurantId/payment-account — connect", () => {
  it("connects and activates a Stripe account when credentials verify", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { object: "balance" });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_abc123xyz", webhookSecret: "whsec_test" } });

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("active");
    expect(res.body.data.account.provider).toBe("stripe");
    expect(res.body.data.account.credentialFingerprint).toContain("xyz");
    expect(res.body.data.webhookUrl).toEqual(expect.stringContaining(`/webhooks/payments/stripe/${res.body.data.account.id}`));

    // Never leaks the encrypted credential envelope.
    expect(res.body.data.account.encryptedCredentials).toBeUndefined();

    const stored = await RestaurantPaymentAccount.findById(res.body.data.account.id);
    expect(stored!.status).toBe("active");
  });

  it("stores the account as invalid, never active, when verification fails", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(401, { error: { message: "Invalid API Key provided" } }, false);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_bad", webhookSecret: "whsec_test" } });

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("invalid");

    const stored = await RestaurantPaymentAccount.findById(res.body.data.account.id);
    expect(stored!.lastVerificationError).toBeTruthy();
  });

  it("reconnecting disconnects the previously active account, never leaving two active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { object: "balance" });
    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_first", webhookSecret: "whsec_test" } });
    expect(first.body.data.account.status).toBe("active");

    mockFetchOnce(200, { object: "balance" });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_second", webhookSecret: "whsec_test" } });
    expect(second.body.data.account.status).toBe("active");

    const activeCount = await RestaurantPaymentAccount.countDocuments({ restaurantId: restaurant.id, status: "active" });
    expect(activeCount).toBe(1);
    const firstAfter = await RestaurantPaymentAccount.findById(first.body.data.account.id);
    expect(firstAfter!.status).toBe("disconnected");
  });

  it("rejects malformed credentials for the declared provider", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /restaurants/:restaurantId/payment-account/disconnect", () => {
  it("disconnects the active account, and GET reflects no connected account afterward", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { object: "balance" });
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_abc", webhookSecret: "whsec_test" } });

    const disconnectRes = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(disconnectRes.status).toBe(200);
    expect(disconnectRes.body.data.account.status).toBe("disconnected");

    const getRes = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(getRes.body.data.account).toBeNull();
  });

  it("404s when there is no active account to disconnect", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});
