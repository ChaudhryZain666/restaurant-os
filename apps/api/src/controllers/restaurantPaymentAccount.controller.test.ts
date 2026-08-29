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

/** Stripe Connect account fixture, ready for Connect endpoints (country + email set — both
 *  required server-side before onboarding can start). */
async function connectableRestaurant() {
  return ownedRestaurant({ country: "US", email: "owner@example.com" });
}

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({ status, ok, json: async () => body } as unknown as Response);
}

function mockFetchSequence(...responses: Array<{ status: number; body: unknown; ok?: boolean }>) {
  const spy = jest.spyOn(globalThis, "fetch");
  for (const r of responses) {
    spy.mockResolvedValueOnce({ status: r.status, ok: r.ok ?? (r.status >= 200 && r.status < 300), json: async () => r.body } as unknown as Response);
  }
  return spy;
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

describe("Phase 38 — cross-tenant isolation on the Stripe Connect endpoints", () => {
  it("owner of restaurant A cannot start/resume a Stripe Connect flow for restaurant B", async () => {
    const { restaurant: restaurantB } = await connectableRestaurant();
    const { ownerToken: ownerAToken } = await connectableRestaurant();

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);

    const stored = await RestaurantPaymentAccount.findOne({ restaurantId: restaurantB.id });
    expect(stored).toBeNull();
  });

  it("owner of restaurant A cannot sync restaurant B's Stripe status", async () => {
    const { restaurant: restaurantB, ownerToken: ownerBToken } = await connectableRestaurant();
    mockFetchSequence(
      { status: 200, body: { id: "acct_isolation_test" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_isolation_test/x" } }
    );
    await request(app).post(`/api/v1/restaurants/${restaurantB.id}/payment-account/connect/stripe`).set("Authorization", `Bearer ${ownerBToken}`);

    const { ownerToken: ownerAToken } = await connectableRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/payment-account/sync-stripe-status`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);
  });

  it("owner of restaurant A cannot disconnect restaurant B's payment account", async () => {
    const { restaurant: restaurantB, ownerToken: ownerBToken } = await ownedRestaurant();
    mockFetchOnce(200, { data: { token: "tok_iso" } });
    await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerBToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_iso", secretKey: "sec_iso", webhookSecret: "wh_iso", env: "sandbox" } });

    const { ownerToken: ownerAToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurantB.id}/payment-account/disconnect`)
      .set("Authorization", `Bearer ${ownerAToken}`);
    expect(res.status).toBe(403);

    const stillActive = await RestaurantPaymentAccount.findOne({ restaurantId: restaurantB.id, status: "active" });
    expect(stillActive).not.toBeNull();
  });

  it("no endpoint accepts a client-supplied connectedAccountId — it is always server-resolved", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    mockFetchSequence(
      { status: 200, body: { id: "acct_real_server_generated" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_real_server_generated/x" } }
    );
    // Even though the body below tries to smuggle a different connectedAccountId, the server must
    // ignore it entirely — createConnectedAccount is the only source of this id.
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ connectedAccountId: "acct_attacker_supplied" });

    const stored = await RestaurantPaymentAccount.findOne({ restaurantId: restaurant.id, provider: "stripe" });
    expect(stored!.connectedAccountId).toBe("acct_real_server_generated");
  });
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

describe("POST /restaurants/:restaurantId/payment-account — manual credentials (Phase 37: Safepay only)", () => {
  it("connects and activates a Safepay account when credentials verify", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { data: { token: "tok_verify" } });

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_abc123xyz", secretKey: "sec_abc", webhookSecret: "wh_abc", env: "sandbox" } });

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("active");
    expect(res.body.data.account.provider).toBe("safepay");
    expect(res.body.data.account.connectionMode).toBe("merchant_credentials");
    expect(res.body.data.webhookUrl).toEqual(expect.stringContaining(`/webhooks/payments/safepay/${res.body.data.account.id}`));
    expect(res.body.data.account.encryptedCredentials).toBeUndefined();
  });

  it("rejects Stripe entirely — Stripe is only connected via real Connect onboarding now", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "stripe", credentials: { secretKey: "sk_test_abc123xyz", webhookSecret: "whsec_test" } });
    expect(res.status).toBe(400);
  });

  it("stores the account as invalid, never active, when verification fails", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(401, { error: "Invalid credentials" }, false);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_bad", secretKey: "sec_bad", webhookSecret: "wh_bad", env: "sandbox" } });

    expect(res.status).toBe(201);
    expect(res.body.data.account.status).toBe("invalid");
  });

  it("reconnecting disconnects the previously active account, never leaving two active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { data: { token: "tok_1" } });
    const first = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_1", secretKey: "sec_1", webhookSecret: "wh_1", env: "sandbox" } });
    expect(first.body.data.account.status).toBe("active");

    mockFetchOnce(200, { data: { token: "tok_2" } });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_2", secretKey: "sec_2", webhookSecret: "wh_2", env: "sandbox" } });
    expect(second.body.data.account.status).toBe("active");

    const activeCount = await RestaurantPaymentAccount.countDocuments({ restaurantId: restaurant.id, status: "active" });
    expect(activeCount).toBe(1);
    const firstAfter = await RestaurantPaymentAccount.findById(first.body.data.account.id);
    expect(firstAfter!.status).toBe("disconnected");
  });

  it("rejects malformed credentials", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "" } });
    expect(res.status).toBe(400);
  });
});

describe("POST /restaurants/:restaurantId/payment-account/connect/stripe (Phase 37)", () => {
  it("requires restaurant.country to be set first", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant({ email: "owner@example.com" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("requires restaurant.email to be set first", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant({ country: "US" });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("creates a connected account and returns a real onboarding URL — never asks for a secret key", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    mockFetchSequence(
      { status: 200, body: { id: "acct_test123" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_test123/abc", expires_at: 123 } }
    );

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe("https://connect.stripe.com/setup/c/acct_test123/abc");
    expect(JSON.stringify(res.body)).not.toMatch(/sk_test|sk_live|secretKey/i);

    const stored = await RestaurantPaymentAccount.findOne({ restaurantId: restaurant.id, provider: "stripe" });
    expect(stored!.connectionMode).toBe("platform_connect");
    expect(stored!.connectedAccountId).toBe("acct_test123");
    expect(stored!.status).toBe("pending_verification");
  });

  it("resuming an in-progress connection reuses the same connected account (no duplicate Stripe accounts created)", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    mockFetchSequence(
      { status: 200, body: { id: "acct_resume" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_resume/first" } }
    );
    await request(app).post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`).set("Authorization", `Bearer ${ownerToken}`);

    // Second call: only ONE fetch (account link) should happen — no second /v1/accounts POST.
    mockFetchOnce(200, { url: "https://connect.stripe.com/setup/c/acct_resume/second" });
    const second = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(second.status).toBe(200);
    const accounts = await RestaurantPaymentAccount.find({ restaurantId: restaurant.id, provider: "stripe" });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].connectedAccountId).toBe("acct_resume");
  });
});

describe("POST /restaurants/:restaurantId/payment-account/sync-stripe-status (Phase 37)", () => {
  async function startedConnect(ownerToken: string, restaurantId: string) {
    mockFetchSequence(
      { status: 200, body: { id: "acct_sync_test" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_sync_test/x" } }
    );
    await request(app).post(`/api/v1/restaurants/${restaurantId}/payment-account/connect/stripe`).set("Authorization", `Bearer ${ownerToken}`);
  }

  it("marks the account active once Stripe reports charges_enabled — never merely from completing the redirect", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    await startedConnect(ownerToken, restaurant.id);

    mockFetchOnce(200, { charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [] } });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/sync-stripe-status`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.account.status).toBe("active");
    expect(res.body.data.account.chargesEnabled).toBe(true);
  });

  it("marks the account action_required when onboarding is incomplete, not active", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    await startedConnect(ownerToken, restaurant.id);

    mockFetchOnce(200, { charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ["individual.dob.day"] } });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/sync-stripe-status`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.account.status).toBe("action_required");
    expect(res.body.data.account.requirementsDue).toEqual(["individual.dob.day"]);
  });

  it("marks the account invalid when Stripe reports a rejection", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    await startedConnect(ownerToken, restaurant.id);

    mockFetchOnce(200, { charges_enabled: false, requirements: { currently_due: [], disabled_reason: "rejected.fraud" } });
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/sync-stripe-status`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.account.status).toBe("invalid");
  });
});

describe("POST /restaurants/:restaurantId/payment-account/disconnect", () => {
  it("disconnects the active account, and GET reflects no connected account afterward", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    mockFetchOnce(200, { data: { token: "tok_disc" } });
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "safepay", credentials: { apiKey: "key_disc", secretKey: "sec_disc", webhookSecret: "wh_disc", env: "sandbox" } });

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

  it("404s when there is no account to disconnect", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });

  it("can disconnect a Stripe Connect account that never finished onboarding (action_required/pending)", async () => {
    const { restaurant, ownerToken } = await connectableRestaurant();
    mockFetchSequence(
      { status: 200, body: { id: "acct_abandon" } },
      { status: 200, body: { url: "https://connect.stripe.com/setup/c/acct_abandon/x" } }
    );
    await request(app).post(`/api/v1/restaurants/${restaurant.id}/payment-account/connect/stripe`).set("Authorization", `Bearer ${ownerToken}`);

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/payment-account/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.account.status).toBe("disconnected");
  });
});
