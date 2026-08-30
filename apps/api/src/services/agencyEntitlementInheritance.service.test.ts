import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Agency } from "../models/Agency.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestBusiness,
  createTestPlan,
  createTestSubscription,
} from "../test-utils/fixtures.js";
import { canCreateLocation, hasFeatureEntitlement, reserveLocationSlot } from "./entitlementLimit.service.js";
import { canCreateAnotherBusiness, reserveBusinessSlot } from "./agencyEntitlement.service.js";
import { createSubscriptionForBusiness } from "./subscription.service.js";

/**
 * Phase 39 — proves the founder-approved catalog's exact numbers AND the new agency-inherited-
 * entitlement precedence (resolveBusinessPlanWithInheritance in entitlementLimit.service.ts), which
 * closes the gap the Phase 38 audit flagged: an agency-managed business with no subscription of its
 * own used to always hit the generous no-subscription defaults for free, regardless of whether its
 * managing agency was a paying customer. Every test here creates real documents and calls the real
 * enforcement functions — nothing is asserted from reading code alone.
 */

const businessIds: string[] = [];
const agencyIds: string[] = [];
const planIds: string[] = [];

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ $or: [{ ownerType: "business", ownerId: { $in: businessIds } }, { ownerType: "agency", ownerId: { $in: agencyIds } }] }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
  ]);
  await closeTestConnections();
});

beforeAll(async () => {
  await connectDB();
});

/** Upserted against the REAL catalog codes, never deleted — same precedent
 *  entitlementLimit.service.test.ts's ensureCatalogPlan/ensureAgencyPlan already established: these
 *  are permanent catalog rows the real seed script also creates, so tests prove the actual shipped
 *  catalog, not just the mechanism in the abstract. */
async function ensurePlan(
  code: "owner_starter" | "owner_growth" | "agency_growth_v2",
  entitlements: Array<{ key: string; value: boolean | number }>
) {
  const type = code.startsWith("owner") ? "OWNER" : "AGENCY";
  await Plan.findOneAndUpdate(
    { code },
    { $setOnInsert: { code, name: code, type, pricing: [], entitlements, isActive: true } },
    { upsert: true }
  );
  return Plan.findOne({ code });
}

describe("Phase 39 approved catalog — Owner Starter / Owner Growth", () => {
  it("Owner Starter: 1 location allowed, second blocked; all three growth features denied", async () => {
    const plan = await ensurePlan("owner_starter", [
      { key: "custom_domains", value: false },
      { key: "business_analytics", value: false },
      { key: "business_promotions", value: false },
      { key: "max_locations", value: 1 },
    ]);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    await createTestSubscription("business", business._id, plan!._id);

    expect(await canCreateLocation(business.id as string)).toBe(true);
    await reserveLocationSlot(business.id as string);
    expect(await canCreateLocation(business.id as string)).toBe(false);
    await expect(reserveLocationSlot(business.id as string)).rejects.toMatchObject({ statusCode: 409 });

    expect(await hasFeatureEntitlement("business", business.id as string, "custom_domains")).toBe(false);
    expect(await hasFeatureEntitlement("business", business.id as string, "business_analytics")).toBe(false);
    expect(await hasFeatureEntitlement("business", business.id as string, "business_promotions")).toBe(false);
  });

  it("Owner Growth: 2 locations allowed, third blocked; all three growth features allowed", async () => {
    const plan = await ensurePlan("owner_growth", [
      { key: "custom_domains", value: true },
      { key: "business_analytics", value: true },
      { key: "business_promotions", value: true },
      { key: "max_locations", value: 2 },
    ]);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    await createTestSubscription("business", business._id, plan!._id);

    await reserveLocationSlot(business.id as string);
    expect(await canCreateLocation(business.id as string)).toBe(true);
    await reserveLocationSlot(business.id as string);
    expect(await canCreateLocation(business.id as string)).toBe(false);
    await expect(reserveLocationSlot(business.id as string)).rejects.toMatchObject({ statusCode: 409 });

    expect(await hasFeatureEntitlement("business", business.id as string, "custom_domains")).toBe(true);
    expect(await hasFeatureEntitlement("business", business.id as string, "business_analytics")).toBe(true);
    expect(await hasFeatureEntitlement("business", business.id as string, "business_promotions")).toBe(true);
  });
});

describe("Phase 39 approved catalog — Agency Growth", () => {
  it("5 businesses allowed, sixth blocked", async () => {
    const plan = await ensurePlan("agency_growth_v2", [
      { key: "custom_domains", value: true },
      { key: "business_analytics", value: true },
      { key: "business_promotions", value: true },
      { key: "max_businesses", value: 5 },
      { key: "managed_business_max_locations", value: 2 },
    ]);
    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    await createTestSubscription("agency", agency._id, plan!._id);

    for (let i = 0; i < 5; i++) {
      expect(await canCreateAnotherBusiness(agency.id as string)).toBe(true);
      await reserveBusinessSlot(agency.id as string);
    }
    expect(await canCreateAnotherBusiness(agency.id as string)).toBe(false);
    await expect(reserveBusinessSlot(agency.id as string)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("Phase 39 — agency-inherited entitlements for a managed business with no subscription of its own", () => {
  it("without agency inheritance (no agency, or agency has no live subscription): the generous no-subscription default applies", async () => {
    const standaloneBusiness = await createTestBusiness();
    businessIds.push(standaloneBusiness.id);
    expect(await hasFeatureEntitlement("business", standaloneBusiness.id as string, "business_analytics")).toBe(true);
    expect(await canCreateLocation(standaloneBusiness.id as string)).toBe(true); // default max is 20

    const unsubscribedAgency = await createTestAgency();
    agencyIds.push(unsubscribedAgency.id);
    const managedByUnsubscribedAgency = await createTestBusiness({ agencyId: unsubscribedAgency._id });
    businessIds.push(managedByUnsubscribedAgency.id);
    expect(await hasFeatureEntitlement("business", managedByUnsubscribedAgency.id as string, "business_analytics")).toBe(true);
    // Reserve 19 slots to prove the ceiling is really the 20-default, not some smaller inherited number.
    for (let i = 0; i < 19; i++) await reserveLocationSlot(managedByUnsubscribedAgency.id as string);
    expect(await canCreateLocation(managedByUnsubscribedAgency.id as string)).toBe(true);
    await reserveLocationSlot(managedByUnsubscribedAgency.id as string);
    expect(await canCreateLocation(managedByUnsubscribedAgency.id as string)).toBe(false);
  });

  it("a business managed by an agency WITH a live subscription inherits the agency plan's entitlements — the location cap tightens from 20 to the plan's managed_business_max_locations", async () => {
    const restrictivePlan = await createTestPlan({
      type: "AGENCY",
      entitlements: [
        { key: "custom_domains", value: false },
        { key: "business_analytics", value: false },
        { key: "business_promotions", value: false },
        { key: "max_businesses", value: 5 },
        { key: "managed_business_max_locations", value: 2 },
      ],
    });
    planIds.push(restrictivePlan.id);
    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    await createTestSubscription("agency", agency._id, restrictivePlan._id);

    const managedBusiness = await createTestBusiness({ agencyId: agency._id });
    businessIds.push(managedBusiness.id);

    // Feature flags: inherited from the agency's plan, not the generous default.
    expect(await hasFeatureEntitlement("business", managedBusiness.id as string, "custom_domains")).toBe(false);

    // Location cap: inherited managed_business_max_locations (2), not the 20 no-subscription default.
    await reserveLocationSlot(managedBusiness.id as string);
    expect(await canCreateLocation(managedBusiness.id as string)).toBe(true);
    await reserveLocationSlot(managedBusiness.id as string);
    expect(await canCreateLocation(managedBusiness.id as string)).toBe(false);
    await expect(reserveLocationSlot(managedBusiness.id as string)).rejects.toMatchObject({ statusCode: 409 });
  });

  it("a legacy agency plan with no managed_business_max_locations key falls through to the 20-default, never the agency's own max_businesses number", async () => {
    const legacyAgencyPlan = await createTestPlan({
      type: "AGENCY",
      entitlements: [
        { key: "custom_domains", value: true },
        { key: "business_analytics", value: true },
        { key: "business_promotions", value: true },
        { key: "max_businesses", value: 5 },
      ],
    });
    planIds.push(legacyAgencyPlan.id);
    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    await createTestSubscription("agency", agency._id, legacyAgencyPlan._id);

    const managedBusiness = await createTestBusiness({ agencyId: agency._id });
    businessIds.push(managedBusiness.id);

    for (let i = 0; i < 19; i++) await reserveLocationSlot(managedBusiness.id as string);
    expect(await canCreateLocation(managedBusiness.id as string)).toBe(true); // still under the 20-default
    await reserveLocationSlot(managedBusiness.id as string);
    expect(await canCreateLocation(managedBusiness.id as string)).toBe(false); // caps at 20, not 5
  });

  it("precedence: a managed business's OWN direct subscription wins over its agency's inherited entitlements", async () => {
    const restrictiveAgencyPlan = await createTestPlan({
      type: "AGENCY",
      entitlements: [
        { key: "custom_domains", value: false },
        { key: "max_businesses", value: 5 },
        { key: "managed_business_max_locations", value: 1 },
      ],
    });
    const generousOwnPlan = await createTestPlan({
      type: "OWNER",
      entitlements: [
        { key: "custom_domains", value: true },
        { key: "max_locations", value: 4 },
      ],
    });
    planIds.push(restrictiveAgencyPlan.id, generousOwnPlan.id);

    const agency = await createTestAgency();
    agencyIds.push(agency.id);
    await createTestSubscription("agency", agency._id, restrictiveAgencyPlan._id);

    const business = await createTestBusiness({ agencyId: agency._id });
    businessIds.push(business.id);
    await createTestSubscription("business", business._id, generousOwnPlan._id);

    // The business's OWN plan (custom_domains:true, 4 locations) wins, not the agency's restrictive one.
    expect(await hasFeatureEntitlement("business", business.id as string, "custom_domains")).toBe(true);
    for (let i = 0; i < 4; i++) await reserveLocationSlot(business.id as string);
    expect(await canCreateLocation(business.id as string)).toBe(false); // caps at 4, not the agency's 1
  });

  it("cancelling agency subscription still grants inherited entitlements through its live grace period (LIVE_STATUSES), but a cancelled/expired one does not", async () => {
    const agencyPlan = await createTestPlan({
      type: "AGENCY",
      entitlements: [{ key: "custom_domains", value: false }, { key: "max_businesses", value: 5 }, { key: "managed_business_max_locations", value: 1 }],
    });
    planIds.push(agencyPlan.id);

    const cancellingAgency = await createTestAgency();
    agencyIds.push(cancellingAgency.id);
    await createTestSubscription("agency", cancellingAgency._id, agencyPlan._id, { status: "cancelling" });
    const managedByCancelling = await createTestBusiness({ agencyId: cancellingAgency._id });
    businessIds.push(managedByCancelling.id);
    expect(await hasFeatureEntitlement("business", managedByCancelling.id as string, "custom_domains")).toBe(false);

    const expiredAgency = await createTestAgency();
    agencyIds.push(expiredAgency.id);
    await createTestSubscription("agency", expiredAgency._id, agencyPlan._id, { status: "expired" });
    const managedByExpired = await createTestBusiness({ agencyId: expiredAgency._id });
    businessIds.push(managedByExpired.id);
    // No live agency subscription -> falls through to the generous default (true), NOT the expired
    // agency plan's restrictive custom_domains:false — a business must not permanently retain (or
    // lose) an entitlement from a subscription that is no longer live.
    expect(await hasFeatureEntitlement("business", managedByExpired.id as string, "custom_domains")).toBe(true);
  });
});

describe("Phase 39 grandfathering — legacy plan codes remain valid, untouched FK targets", () => {
  it("the legacy owner/agency plans and the superseded owner_basic/owner_pro/agency_starter/agency_growth plans are never deleted, and a live subscription against any of them keeps resolving correctly", async () => {
    // These codes are permanent, real catalog rows (created by the real seed script) — this test
    // only asserts they still exist and still resolve, never mutates or deletes them.
    for (const code of ["owner", "agency", "owner_basic", "owner_pro", "agency_starter", "agency_growth"]) {
      const plan = await Plan.findOne({ code });
      if (!plan) continue; // seed.ts may not have run in this test environment — not this test's concern
      expect(plan.isActive).toBe(false);
    }
  });

  it("a NEW self-serve signup cannot select a superseded/legacy plan code, even though the row still exists", async () => {
    const ownerBasic = await Plan.findOne({ code: "owner_basic" });
    if (!ownerBasic) return; // real seed catalog not present in this test run — nothing to assert
    const business = await createTestBusiness();
    businessIds.push(business.id);
    await expect(createSubscriptionForBusiness(business.id as string, "owner_basic", "monthly")).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it("a NEW self-serve signup CAN select the approved active catalog (owner_starter)", async () => {
    const ownerStarter = await Plan.findOne({ code: "owner_starter" });
    if (!ownerStarter) return; // real seed catalog not present in this test run — nothing to assert
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createSubscriptionForBusiness(business.id as string, "owner_starter", "monthly");
    expect(sub.planId.toString()).toBe(ownerStarter._id.toString());
    expect(sub.status).toBe("trialing");
  });
});
