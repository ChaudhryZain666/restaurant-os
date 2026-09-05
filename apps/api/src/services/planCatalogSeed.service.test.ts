import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { User } from "../models/User.js";
import { closeTestConnections } from "../test-utils/fixtures.js";
import { seedPlanCatalog } from "./planCatalogSeed.service.js";

const ACTIVE_CODES = ["owner_starter", "owner_growth", "agency_growth_v2"] as const;
const INACTIVE_CODES = ["owner", "agency", "owner_basic", "owner_pro", "agency_starter", "agency_growth"] as const;
const ALL_CODES = [...ACTIVE_CODES, ...INACTIVE_CODES];

beforeAll(async () => {
  await connectDB();
  // This suite runs against this project's long-lived shared dev/test database, which — as this
  // very audit phase exists to fix — can carry stale/corrupted Plan documents left over from
  // earlier sessions (the well-documented "polluted local plans catalog" issue). $setOnInsert only
  // ever protects an EXISTING document from being overwritten; it can't retroactively fix one that
  // was already wrong. So this suite starts from a genuinely clean slate for exactly the 9 codes it
  // tests — a fair, deterministic proxy for "seeding into an empty production database," which is
  // this phase's actual subject, rather than being at the mercy of this session's accumulated
  // drift. Never touches any other Plan code.
  await Plan.deleteMany({ code: { $in: ALL_CODES } });
});

afterAll(async () => {
  await closeTestConnections();
});

describe("seedPlanCatalog (Phase 43 — production-safe commercial catalog seed)", () => {
  it("creates every required plan code, active and inactive", async () => {
    await seedPlanCatalog();
    const plans = await Plan.find({ code: { $in: ALL_CODES } });
    expect(plans.map((p) => p.code).sort()).toEqual([...ALL_CODES].sort());
  });

  it("owner_starter has the founder-approved $59/$590 pricing and entitlements", async () => {
    await seedPlanCatalog();
    const plan = await Plan.findOne({ code: "owner_starter" });
    expect(plan).not.toBeNull();
    expect(plan!.isActive).toBe(true);
    expect(plan!.pricing.find((p) => p.interval === "monthly")?.amountCents).toBe(5900);
    expect(plan!.pricing.find((p) => p.interval === "yearly")?.amountCents).toBe(59000);
    const entitlements = Object.fromEntries(plan!.entitlements.map((e) => [e.key, e.value]));
    expect(entitlements.max_locations).toBe(1);
    expect(entitlements.custom_domains).toBe(false);
  });

  it("owner_growth has the founder-approved $99/$990 pricing and entitlements", async () => {
    await seedPlanCatalog();
    const plan = await Plan.findOne({ code: "owner_growth" });
    expect(plan).not.toBeNull();
    expect(plan!.isActive).toBe(true);
    expect(plan!.pricing.find((p) => p.interval === "monthly")?.amountCents).toBe(9900);
    expect(plan!.pricing.find((p) => p.interval === "yearly")?.amountCents).toBe(99000);
    const entitlements = Object.fromEntries(plan!.entitlements.map((e) => [e.key, e.value]));
    expect(entitlements.max_locations).toBe(2);
    expect(entitlements.custom_domains).toBe(true);
  });

  it("agency_growth_v2 has the founder-approved $179/$1,790 pricing and entitlements", async () => {
    await seedPlanCatalog();
    const plan = await Plan.findOne({ code: "agency_growth_v2" });
    expect(plan).not.toBeNull();
    expect(plan!.isActive).toBe(true);
    expect(plan!.pricing.find((p) => p.interval === "monthly")?.amountCents).toBe(17900);
    expect(plan!.pricing.find((p) => p.interval === "yearly")?.amountCents).toBe(179000);
    const entitlements = Object.fromEntries(plan!.entitlements.map((e) => [e.key, e.value]));
    expect(entitlements.max_businesses).toBe(5);
    expect(entitlements.managed_business_max_locations).toBe(2);
  });

  it("every legacy/retired plan code is isActive:false", async () => {
    await seedPlanCatalog();
    const plans = await Plan.find({ code: { $in: INACTIVE_CODES } });
    expect(plans).toHaveLength(INACTIVE_CODES.length);
    for (const plan of plans) {
      expect(plan.isActive).toBe(false);
    }
  });

  it("is idempotent — re-running never duplicates plans or changes an already-seeded document's content", async () => {
    await seedPlanCatalog();
    const before = await Plan.findOne({ code: "owner_starter" }).lean();
    const countBefore = await Plan.countDocuments({ code: { $in: ALL_CODES } });

    await seedPlanCatalog();
    await seedPlanCatalog();

    const countAfter = await Plan.countDocuments({ code: { $in: ALL_CODES } });
    const after = await Plan.findOne({ code: "owner_starter" }).lean();

    expect(countAfter).toBe(countBefore);
    // $setOnInsert protects the CONTENT of an already-existing document (pricing/entitlements/name/
    // etc, never overwritten on a repeat call) — compared field-by-field rather than the whole
    // document, since Mongoose's own timestamps plugin bumps updatedAt on every findOneAndUpdate
    // call regardless of whether $setOnInsert actually matched anything, which is unrelated to
    // whether the catalog content itself is untouched.
    expect(after!.pricing).toEqual(before!.pricing);
    expect(after!.entitlements).toEqual(before!.entitlements);
    expect(after!.name).toBe(before!.name);
    expect(after!.isActive).toBe(before!.isActive);
  });

  it("creates zero User documents — the production-safe seed must never create an account", async () => {
    const usersBefore = await User.countDocuments();
    await seedPlanCatalog();
    const usersAfter = await User.countDocuments();
    expect(usersAfter).toBe(usersBefore);
  });
});
