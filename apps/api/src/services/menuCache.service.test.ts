import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { redis } from "../config/redis.js";
import { Restaurant } from "../models/Restaurant.js";
import { closeTestConnections, createTestBusiness, createTestRestaurant } from "../test-utils/fixtures.js";
import { invalidateMenuCache, invalidateMenuCacheForBusiness, menuCacheKey } from "./menuCache.service.js";

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let locationA: Awaited<ReturnType<typeof createTestRestaurant>>;
let locationB: Awaited<ReturnType<typeof createTestRestaurant>>;
let unrelatedLocation: Awaited<ReturnType<typeof createTestRestaurant>>;

beforeAll(async () => {
  await connectDB();
  business = await createTestBusiness();
  locationA = await createTestRestaurant({ businessId: business._id });
  locationB = await createTestRestaurant({ businessId: business._id });
  unrelatedLocation = await createTestRestaurant();
});

afterAll(async () => {
  await Restaurant.deleteMany({ _id: { $in: [locationA._id, locationB._id, unrelatedLocation._id] } });
  await closeTestConnections();
});

describe("invalidateMenuCacheForBusiness", () => {
  it("invalidates every location under the business, and never touches an unrelated restaurant's key", async () => {
    await redis.set(menuCacheKey(locationA.id), "cached-a", "EX", 60);
    await redis.set(menuCacheKey(locationB.id), "cached-b", "EX", 60);
    await redis.set(menuCacheKey(unrelatedLocation.id), "cached-unrelated", "EX", 60);

    await invalidateMenuCacheForBusiness(business.id);

    expect(await redis.get(menuCacheKey(locationA.id))).toBeNull();
    expect(await redis.get(menuCacheKey(locationB.id))).toBeNull();
    expect(await redis.get(menuCacheKey(unrelatedLocation.id))).toBe("cached-unrelated");

    await redis.del(menuCacheKey(unrelatedLocation.id));
  });

  it("is a safe no-op for a business with no locations", async () => {
    const emptyBusiness = await createTestBusiness();
    await expect(invalidateMenuCacheForBusiness(emptyBusiness.id)).resolves.toBeUndefined();
  });
});

describe("invalidateMenuCache (single-location, unchanged behavior)", () => {
  it("still only invalidates its own restaurantId's key", async () => {
    await redis.set(menuCacheKey(locationA.id), "cached-a", "EX", 60);
    await redis.set(menuCacheKey(locationB.id), "cached-b", "EX", 60);

    await invalidateMenuCache(locationA.id);

    expect(await redis.get(menuCacheKey(locationA.id))).toBeNull();
    expect(await redis.get(menuCacheKey(locationB.id))).toBe("cached-b");

    await redis.del(menuCacheKey(locationB.id));
  });
});
