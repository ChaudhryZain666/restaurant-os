import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { httpCorsOrigins, realtimeOrigins } from "../config/origins.js";
import { DomainMapping } from "../models/DomainMapping.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { closeTestConnections, createTestBusiness, createTestPlan, createTestRestaurant, createTestSubscription } from "../test-utils/fixtures.js";
import { clearRealtimeOriginCache, createRealtimeOriginCheck, isActiveCustomDomainOrigin } from "./realtimeOrigins.js";

const PRODUCTION_ORIGINS = {
  CLIENT_ORIGIN: "https://order.garnishtable.com",
  ADMIN_ORIGIN: "https://app.garnishtable.com",
  MARKETING_ORIGIN: "https://garnishtable.com",
  PORTAL_ORIGINS: ["https://agency.garnishtable.com", "https://admin.garnishtable.com", "https://pos.garnishtable.com"],
};

describe("origin allow-lists (Phase 85A)", () => {
  it("HTTP CORS covers every GarnishTable surface, including all four admin-app portals", () => {
    expect(httpCorsOrigins(PRODUCTION_ORIGINS).sort()).toEqual(
      [
        "https://admin.garnishtable.com",
        "https://agency.garnishtable.com",
        "https://app.garnishtable.com",
        "https://garnishtable.com",
        "https://order.garnishtable.com",
        "https://pos.garnishtable.com",
      ].sort()
    );
  });

  it("Socket.IO covers the storefront and every portal (POS/kitchen realtime) but not marketing", () => {
    const origins = realtimeOrigins(PRODUCTION_ORIGINS);
    expect(origins).toContain("https://pos.garnishtable.com");
    expect(origins).toContain("https://order.garnishtable.com");
    expect(origins).not.toContain("https://garnishtable.com");
  });
});

function check(origin: string | undefined, isCustom: (o: string) => Promise<boolean> = async () => false) {
  return new Promise<boolean | undefined>((resolve, reject) => {
    createRealtimeOriginCheck(realtimeOrigins(PRODUCTION_ORIGINS), isCustom)(origin, (err, allow) => (err ? reject(err) : resolve(allow)));
  });
}

describe("createRealtimeOriginCheck", () => {
  it("allows configured origins and requests without an Origin header", async () => {
    expect(await check("https://pos.garnishtable.com")).toBe(true);
    expect(await check(undefined)).toBe(true);
  });

  it("allows an unknown origin only when it is an active custom domain", async () => {
    expect(await check("https://orders.somerestaurant.com", async () => true)).toBe(true);
    expect(await check("https://evil.example", async () => false)).toBe(false);
  });

  it("fails closed when the custom-domain lookup errors", async () => {
    expect(await check("https://orders.somerestaurant.com", async () => Promise.reject(new Error("db down")))).toBe(false);
  });
});

describe("isActiveCustomDomainOrigin", () => {
  const hostname = `orders-${Date.now()}.realtime-test.example`;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(() => {
    clearRealtimeOriginCache();
  });

  const cleanupIds: mongoose.Types.ObjectId[] = [];

  afterAll(async () => {
    await DomainMapping.deleteMany({ hostname: { $in: [hostname, `pending-${hostname}`] } });
    await Promise.all([
      Subscription.deleteMany({ ownerId: { $in: cleanupIds } }),
      Restaurant.deleteMany({ _id: { $in: cleanupIds } }),
      Business.deleteMany({ _id: { $in: cleanupIds } }),
      Plan.deleteMany({ _id: { $in: cleanupIds } }),
    ]);
    await closeTestConnections();
  });

  it("accepts an https origin whose hostname is a LIVE custom domain, and nothing else", async () => {
    // Phase 86 — "live" is the shared decision (customDomain.service.ts): active mapping, active
    // restaurant, entitled business.
    const business = await createTestBusiness();
    const restaurant = await createTestRestaurant({ businessId: business._id, ownerId: business.ownerId, status: "active" });
    const other = await createTestRestaurant({ businessId: business._id, ownerId: business.ownerId, status: "active" });
    const plan = await createTestPlan({ code: `realtime-${Date.now()}`, entitlements: [{ key: "custom_domains", value: true }] });
    await createTestSubscription("business", business._id, plan._id);
    cleanupIds.push(business._id, restaurant._id, other._id, plan._id);
    const ids = { businessId: business._id, verificationToken: "t" };
    await DomainMapping.create({ ...ids, locationId: restaurant._id, hostname, status: "active" });
    await DomainMapping.create({ ...ids, locationId: other._id, hostname: `pending-${hostname}`, status: "verified" });

    expect(await isActiveCustomDomainOrigin(`https://${hostname}`)).toBe(true);
    expect(await isActiveCustomDomainOrigin(`https://pending-${hostname}`)).toBe(false);
    expect(await isActiveCustomDomainOrigin(`http://${hostname}`)).toBe(false);
    expect(await isActiveCustomDomainOrigin(`https://${hostname}/path`)).toBe(false);
    expect(await isActiveCustomDomainOrigin("not a url")).toBe(false);
  });
});
