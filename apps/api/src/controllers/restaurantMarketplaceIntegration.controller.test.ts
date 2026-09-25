import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Restaurant } from "../models/Restaurant.js";
import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
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

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    RestaurantMarketplaceIntegration.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
  ]);
  await closeTestConnections();
});

describe("GET /restaurants/:restaurantId/marketplace-integrations", () => {
  it("returns an empty array when nothing is connected — never a fake connected row", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.integrations).toEqual([]);
  });

  it("staff without restaurant.marketplace.read is forbidden", async () => {
    const { restaurant, staffToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("an agency member managing this business CAN read — unlike restaurant.payments.manage, marketplace integrations are not owner-only", async () => {
    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    // agencyGrantsBusinessAccess (middleware/businessLocation.ts) resolves via Business.agencyId
    // first, THEN cross-checks AgencyMembership.businessIds for agency_staff specifically — both
    // links are required, not just the membership row.
    const business = await createTestBusiness({ agencyId: agency._id });
    const restaurant = await createTestRestaurant({ businessId: business._id });
    businessIds.push(business.id);
    restaurantIds.push(restaurant.id);

    const agencyUser = await createTestUser("agency_member");
    userIds.push(agencyUser.id as string);
    await createTestAgencyMembership(agency._id, agencyUser._id, { role: "agency_staff", businessIds: [business._id] });
    const agencyToken = tokenFor(agencyUser, [{ agencyId: agency.id, role: "agency_staff" }]);

    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${agencyToken}`);
    expect(res.status).toBe(200);
  });

  it("a different restaurant's owner cannot list this restaurant's integrations (tenant isolation)", async () => {
    const { restaurant } = await ownedRestaurant();
    const { ownerToken: otherOwnerToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${otherOwnerToken}`);
    expect(res.status).toBe(403);
  });

  it("includes a connect capability per provider — uber_eats reports oauth_redirect (its real, mock-exercisable OAuth flow) even in mock mode; doordash/foodpanda report manual_store_id, the sanctioned dev/test backdoor for providers with no real connect flow", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.capabilities.uber_eats.connect).toEqual({ mechanism: "oauth_redirect" });
    expect(res.body.data.capabilities.doordash.connect).toEqual({ mechanism: "manual_store_id" });
    expect(res.body.data.capabilities.foodpanda.connect).toEqual({ mechanism: "manual_store_id" });
  });
});

describe("POST /restaurants/:restaurantId/marketplace-integrations — connect", () => {
  it("connects and activates against the mock provider (MARKETPLACE_PROVIDER_MODE=mock, the test default)", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "doordash", externalStoreId: "store_123" });

    expect(res.status).toBe(201);
    expect(res.body.data.integration.status).toBe("active");
    expect(res.body.data.integration.provider).toBe("doordash");
    expect(res.body.data.integration.externalStoreId).toBe("store_123");
  });

  it("never returns encryptedCredentials in the response, even though the field exists on the schema", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "doordash", externalStoreId: "store_secret" });
    expect(res.body.data.integration.encryptedCredentials).toBeUndefined();
  });

  it("rejects an unrecognized provider", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "grubhub", externalStoreId: "store_123" });
    expect(res.status).toBe(400);
  });

  it("rejects uber_eats — its resolved capability is oauth_redirect, not manual_store_id, even in mock mode (the real connect flow lives at POST .../uber_eats/connect/start instead)", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "uber_eats", externalStoreId: "store_123" });
    expect(res.status).toBe(400);
  });

  it("staff without restaurant.marketplace.manage cannot connect", async () => {
    const { restaurant, staffToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ provider: "doordash", externalStoreId: "store_123" });
    expect(res.status).toBe(403);
  });

  it("reconnecting disconnects the previously active integration for that provider, never leaving two active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "doordash", externalStoreId: "store_a" });
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "doordash", externalStoreId: "store_b" });

    const activeCount = await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id, provider: "doordash", status: "active" });
    expect(activeCount).toBe(1);
  });

  it("connecting a second, different provider does not disturb the first", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "foodpanda", externalStoreId: "store_fp_second_provider_test" });
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "doordash", externalStoreId: "store_dd" });

    const activeCount = await RestaurantMarketplaceIntegration.countDocuments({ restaurantId: restaurant._id, status: "active" });
    expect(activeCount).toBe(2);
  });
});

describe("POST /restaurants/:restaurantId/marketplace-integrations/:provider/disconnect", () => {
  it("disconnects, and a subsequent GET no longer lists it as active", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "foodpanda", externalStoreId: "store_fp" });

    const disconnect = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/foodpanda/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(disconnect.status).toBe(200);
    expect(disconnect.body.data.integration.status).toBe("disconnected");

    const after = await request(app)
      .get(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(after.body.data.integrations).toEqual([]);
  });

  it("404s when there is nothing to disconnect for that provider", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/doordash/disconnect`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});

describe("POST /restaurants/:restaurantId/marketplace-integrations/:provider/sync", () => {
  it("enqueues a menu-sync job rather than syncing inline", async () => {
    const { notificationQueue } = await import("../queues/notification.queue.js");
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);

    const { restaurant, ownerToken } = await ownedRestaurant();
    const connect = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ provider: "foodpanda", externalStoreId: "store_sync" });
    const integrationId = connect.body.data.integration.id;

    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/foodpanda/sync`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(addSpy).toHaveBeenCalledWith("marketplace.menu_sync", { integrationId });
  });

  it("404s when there is no active integration for that provider", async () => {
    const { restaurant, ownerToken } = await ownedRestaurant();
    const res = await request(app)
      .post(`/api/v1/restaurants/${restaurant.id}/marketplace-integrations/doordash/sync`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(404);
  });
});
