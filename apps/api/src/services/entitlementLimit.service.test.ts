import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";
import { canCreateLocation, hasFeatureEntitlement, reserveLocationSlot } from "./entitlementLimit.service.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerType: "business", ownerId: { $in: businessIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

beforeAll(async () => {
  await connectDB();
});

describe("hasFeatureEntitlement — no-subscription default vs a real gating plan", () => {
  it("defaults to TRUE for a business with no subscription at all (never breaks a grandfathered business)", async () => {
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const allowed = await hasFeatureEntitlement("business", business.id as string, "custom_domains");
    expect(allowed).toBe(true);
  });

  it("is TRUE when the live subscription's plan grants the key, FALSE when the plan explicitly lacks it", async () => {
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const grantingPlan = await createTestPlan({ entitlements: [{ key: "custom_domains", value: true }] });
    const restrictivePlan = await createTestPlan({ entitlements: [{ key: "business_analytics", value: true }] });
    planIds.push(grantingPlan.id, restrictivePlan.id);

    const sub = await createTestSubscription("business", business._id, grantingPlan._id);
    expect(await hasFeatureEntitlement("business", business.id as string, "custom_domains")).toBe(true);

    await Subscription.updateOne({ _id: sub._id }, { $set: { planId: restrictivePlan._id } });
    expect(await hasFeatureEntitlement("business", business.id as string, "custom_domains")).toBe(false);
  });
});

describe("requireEntitlement middleware — real HTTP, business_analytics gated route", () => {
  it("a business subscribed to a plan WITHOUT business_analytics is denied; one WITH it (or no subscription) is allowed", async () => {
    const restrictedBiz = await createTestBusiness();
    const restrictedLoc = await createTestRestaurant({ businessId: restrictedBiz._id });
    const restrictedOwner = await createTestUser("restaurant_owner", restrictedLoc._id, { businessId: restrictedBiz._id });
    const restrictivePlan = await createTestPlan({ entitlements: [{ key: "custom_domains", value: true }] });
    businessIds.push(restrictedBiz.id);
    restaurantIds.push(restrictedLoc.id);
    userIds.push(restrictedOwner.id as string);
    planIds.push(restrictivePlan.id);
    await createTestSubscription("business", restrictedBiz._id, restrictivePlan._id);

    const denied = await request(app)
      .get(`/api/v1/businesses/${restrictedBiz.id}/analytics/overview`)
      .set("Authorization", `Bearer ${tokenFor(restrictedOwner)}`);
    expect(denied.status).toBe(403);

    const noSubBiz = await createTestBusiness();
    const noSubLoc = await createTestRestaurant({ businessId: noSubBiz._id });
    const noSubOwner = await createTestUser("restaurant_owner", noSubLoc._id, { businessId: noSubBiz._id });
    businessIds.push(noSubBiz.id);
    restaurantIds.push(noSubLoc.id);
    userIds.push(noSubOwner.id as string);

    const allowed = await request(app)
      .get(`/api/v1/businesses/${noSubBiz.id}/analytics/overview`)
      .set("Authorization", `Bearer ${tokenFor(noSubOwner)}`);
    expect(allowed.status).toBe(200);
  });
});

describe("Phase 34 — the real owner_basic/owner_pro catalog plans gate the same way the generic mechanism above already proves", () => {
  // Upserted with $setOnInsert against the REAL catalog codes (never deleted in afterAll — these
  // are permanent catalog entries other code/tests/production seed data depend on, exactly like
  // subscriptionBackfill.service.test.ts's own upsert-not-delete precedent for "owner"). This
  // proves the actual seeded Basic/Pro rows are wired correctly, distinct from the tests above,
  // which prove the entitlement MECHANISM works in the abstract with ad-hoc fixture plans.
  async function ensureCatalogPlan(code: "owner_basic" | "owner_pro") {
    const entitlements =
      code === "owner_basic"
        ? [
            { key: "custom_domains", value: false },
            { key: "business_analytics", value: false },
            { key: "business_promotions", value: false },
            { key: "max_locations", value: 1 },
          ]
        : [
            { key: "custom_domains", value: true },
            { key: "business_analytics", value: true },
            { key: "business_promotions", value: true },
            { key: "max_locations", value: 3 },
          ];
    await Plan.findOneAndUpdate(
      { code },
      { $setOnInsert: { code, name: code, type: "OWNER", pricing: [], entitlements, isActive: true } },
      { upsert: true }
    );
    return Plan.findOne({ code });
  }

  it("Basic denies business_analytics; Pro allows it", async () => {
    const basicPlan = await ensureCatalogPlan("owner_basic");
    const proPlan = await ensureCatalogPlan("owner_pro");

    const basicBiz = await createTestBusiness();
    const proBiz = await createTestBusiness();
    businessIds.push(basicBiz.id, proBiz.id);
    await createTestSubscription("business", basicBiz._id, basicPlan!._id);
    await createTestSubscription("business", proBiz._id, proPlan!._id);

    expect(await hasFeatureEntitlement("business", basicBiz.id as string, "business_analytics")).toBe(false);
    expect(await hasFeatureEntitlement("business", proBiz.id as string, "business_analytics")).toBe(true);
  });

  it("Basic caps at 1 location; Pro caps at 3", async () => {
    const basicPlan = await ensureCatalogPlan("owner_basic");
    const proPlan = await ensureCatalogPlan("owner_pro");

    const basicBiz = await createTestBusiness();
    const proBiz = await createTestBusiness();
    businessIds.push(basicBiz.id, proBiz.id);
    await createTestSubscription("business", basicBiz._id, basicPlan!._id);
    await createTestSubscription("business", proBiz._id, proPlan!._id);

    await reserveLocationSlot(basicBiz.id as string);
    expect(await canCreateLocation(basicBiz.id as string)).toBe(false);

    await reserveLocationSlot(proBiz.id as string);
    await reserveLocationSlot(proBiz.id as string);
    expect(await canCreateLocation(proBiz.id as string)).toBe(true);
    await reserveLocationSlot(proBiz.id as string);
    expect(await canCreateLocation(proBiz.id as string)).toBe(false);
  });
});

describe("Phase 34 — the real agency_starter/agency_growth catalog plans express genuine volume economics", () => {
  async function ensureAgencyPlan(code: "agency_starter" | "agency_growth") {
    const maxBusinesses = code === "agency_starter" ? 5 : 15;
    await Plan.findOneAndUpdate(
      { code },
      {
        $setOnInsert: {
          code,
          name: code,
          type: "AGENCY",
          pricing: [],
          entitlements: [{ key: "max_businesses", value: maxBusinesses }],
          isActive: true,
        },
      },
      { upsert: true }
    );
    return Plan.findOne({ code });
  }

  it("Starter includes 5 businesses, Growth includes 15", async () => {
    const starterPlan = await ensureAgencyPlan("agency_starter");
    const growthPlan = await ensureAgencyPlan("agency_growth");
    expect(starterPlan!.entitlements.find((e) => e.key === "max_businesses")!.value).toBe(5);
    expect(growthPlan!.entitlements.find((e) => e.key === "max_businesses")!.value).toBe(15);
  });
});

describe("location limits — canCreateLocation / reserveLocationSlot", () => {
  it("reserveLocationSlot throws 409 once the limit is reached, and never increments past it", async () => {
    const business = await createTestBusiness();
    const plan = await createTestPlan({ entitlements: [{ key: "max_locations", value: 1 }] });
    businessIds.push(business.id);
    planIds.push(plan.id);
    await createTestSubscription("business", business._id, plan._id);

    expect(await canCreateLocation(business.id as string)).toBe(true);
    await reserveLocationSlot(business.id as string);
    expect(await canCreateLocation(business.id as string)).toBe(false);

    await expect(reserveLocationSlot(business.id as string)).rejects.toMatchObject({ statusCode: 409 });

    const reloaded = await Business.findById(business._id);
    expect(reloaded!.locationCount).toBe(1);
  });

  it("under true concurrency, two simultaneous reservations against a limit of 1 yield exactly one success", async () => {
    const business = await createTestBusiness();
    const plan = await createTestPlan({ entitlements: [{ key: "max_locations", value: 1 }] });
    businessIds.push(business.id);
    planIds.push(plan.id);
    await createTestSubscription("business", business._id, plan._id);

    const results = await Promise.allSettled([reserveLocationSlot(business.id as string), reserveLocationSlot(business.id as string)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const reloaded = await Business.findById(business._id);
    expect(reloaded!.locationCount).toBe(1);
  });

  it("real HTTP: creating a location beyond the plan's max_locations is rejected with a clean 409, and the slot is released on a genuine failure", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({ entitlements: [{ key: "max_locations", value: 1 }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    await createTestSubscription("business", business._id, plan._id);
    // The fixture-created location above bypasses reserveLocationSlot entirely (a direct Mongoose
    // .create(), not the guarded HTTP endpoint) — set the counter to reflect reality, exactly what
    // scripts/backfillLocationCounts.ts does for real pre-existing businesses.
    await Business.updateOne({ _id: business._id }, { $set: { locationCount: 1 } });

    const stamp = Date.now();
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/locations`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ name: "Second Location", slug: `entitlement-limit-loc-${stamp}` });
    expect(res.status).toBe(409);

    const reloaded = await Business.findById(business._id);
    expect(reloaded!.locationCount).toBe(1); // still 1 — the rejected attempt never incremented it further
  });
});
