import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { closeTestConnections, createTestBusiness, createTestPlan } from "../test-utils/fixtures.js";
import { backfillSubscriptions } from "./subscriptionBackfill.service.js";

let ownerPlan: Awaited<ReturnType<typeof createTestPlan>>;
let businessNoSub: Awaited<ReturnType<typeof createTestBusiness>>;
let businessAlreadySubscribed: Awaited<ReturnType<typeof createTestBusiness>>;

beforeAll(async () => {
  await connectDB();
  // The real migration matches on Plan.code === "owner"; a fixture-scoped Plan with that exact
  // code lets this test exercise the real lookup without depending on the dev-only seed script
  // having been run first.
  ownerPlan = await Plan.findOneAndUpdate(
    { code: "owner" },
    { $setOnInsert: { code: "owner", name: "Owner", type: "OWNER", pricing: [], entitlements: [], isActive: true } },
    { upsert: true, new: true }
  );
  businessNoSub = await createTestBusiness();
  businessAlreadySubscribed = await createTestBusiness();
  await Subscription.create({
    ownerType: "business",
    ownerId: businessAlreadySubscribed._id,
    planId: ownerPlan._id,
    status: "cancelled", // even a non-live, historical subscription counts as "already has one"
    billingInterval: "monthly",
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    provider: "mock",
  });
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerType: "business", ownerId: { $in: [businessNoSub._id, businessAlreadySubscribed._id] } }),
    Business.deleteMany({ _id: { $in: [businessNoSub._id, businessAlreadySubscribed._id] } }),
  ]);
  await closeTestConnections();
});

describe("backfillSubscriptions — dry run vs real, idempotency", () => {
  it("dry run reports what WOULD happen without writing anything", async () => {
    const summary = await backfillSubscriptions({ dryRun: true, businessIds: [businessNoSub.id as string, businessAlreadySubscribed.id as string] });
    const entry = summary.find((s) => s.businessId === (businessNoSub.id as string));
    expect(entry?.action).toBe("created");

    const stillNone = await Subscription.findOne({ ownerType: "business", ownerId: businessNoSub._id });
    expect(stillNone).toBeNull();
  });

  it("skips a business that already has ANY subscription document, live or historical", async () => {
    const summary = await backfillSubscriptions({ dryRun: true, businessIds: [businessNoSub.id as string, businessAlreadySubscribed.id as string] });
    const entry = summary.find((s) => s.businessId === (businessAlreadySubscribed.id as string));
    expect(entry?.action).toBe("skipped-existing-subscription");
  });

  it("a real run creates an active, provider:internal, grandfathered subscription", async () => {
    const summary = await backfillSubscriptions({ dryRun: false, businessIds: [businessNoSub.id as string, businessAlreadySubscribed.id as string] });
    const entry = summary.find((s) => s.businessId === (businessNoSub.id as string));
    expect(entry?.action).toBe("created");

    const created = await Subscription.findOne({ ownerType: "business", ownerId: businessNoSub._id });
    expect(created).not.toBeNull();
    expect(created!.status).toBe("active");
    expect(created!.provider).toBe("internal");
    expect(created!.planId.toString()).toBe((ownerPlan._id as { toString(): string }).toString());
    expect(created!.currentPeriodEnd.getFullYear()).toBeGreaterThan(new Date().getFullYear() + 50);
  });

  it("re-running is a no-op — idempotent", async () => {
    const summary = await backfillSubscriptions({ dryRun: false, businessIds: [businessNoSub.id as string, businessAlreadySubscribed.id as string] });
    const entry = summary.find((s) => s.businessId === (businessNoSub.id as string));
    expect(entry?.action).toBe("skipped-existing-subscription");

    const count = await Subscription.countDocuments({ ownerType: "business", ownerId: businessNoSub._id });
    expect(count).toBe(1);
  });
});
