import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestBusiness,
  createTestPlan,
  createTestSubscription,
} from "../test-utils/fixtures.js";
import { createSubscriptionForBusiness, createSubscriptionForAgency, runTrialExpirationSweep } from "./subscription.service.js";
import { isSubscriptionLive, resolveSubscriptionState } from "./subscriptionResolution.service.js";

/**
 * Phase 63 — proves the actual trial lifecycle end to end, not just the architecture. The critical
 * finding this phase closes: before it, NOTHING autonomously transitioned a "trialing" subscription
 * to "expired" once its trial period genuinely elapsed (the only prior trigger was a real billing
 * provider webhook, which has never fired in any environment) — every trial silently stayed live,
 * with full plan entitlements, forever. These tests prove both halves of the fix: the real-time
 * boundary check (isSubscriptionLive/resolveSubscriptionState, exact to the millisecond, independent
 * of any cron) and the background sweep (runTrialExpirationSweep) that eventually persists the
 * correct status.
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

describe("isSubscriptionLive — pure boundary exactness (no fake timers, no DB dependency)", () => {
  it("a trialing subscription is live exactly up to (but not including) its trialEnd instant", () => {
    const trialEnd = new Date("2026-01-15T12:00:00.000Z");
    // 1ms before the boundary: live.
    expect(isSubscriptionLive({ status: "trialing", trialEnd }, new Date(trialEnd.getTime() - 1))).toBe(true);
    // Exactly at the boundary: NOT live — the boundary itself is exclusive, not inclusive.
    expect(isSubscriptionLive({ status: "trialing", trialEnd }, trialEnd)).toBe(false);
    // 1ms after: NOT live.
    expect(isSubscriptionLive({ status: "trialing", trialEnd }, new Date(trialEnd.getTime() + 1))).toBe(false);
  });

  it("active/past_due/cancelling are live regardless of trialEnd (which is irrelevant once converted)", () => {
    const pastTrialEnd = new Date("2020-01-01T00:00:00.000Z");
    for (const status of ["active", "past_due", "cancelling"] as const) {
      expect(isSubscriptionLive({ status, trialEnd: pastTrialEnd })).toBe(true);
    }
  });

  it("cancelled/expired are never live, even with a future trialEnd (terminal states, not reachable in practice but defensively correct)", () => {
    const futureTrialEnd = new Date(Date.now() + 1000 * 60 * 60 * 24);
    expect(isSubscriptionLive({ status: "cancelled", trialEnd: futureTrialEnd })).toBe(false);
    expect(isSubscriptionLive({ status: "expired", trialEnd: futureTrialEnd })).toBe(false);
  });

  it("a trialing subscription with no trialEnd at all stays live (defensive — every real creation path always sets one)", () => {
    expect(isSubscriptionLive({ status: "trialing", trialEnd: undefined })).toBe(true);
  });
});

describe("createSubscriptionForBusiness / createSubscriptionForAgency — trial timestamp correctness", () => {
  it("trialStart is now, trialEnd is exactly trialDays*24h later, using the env default when the plan has no override", async () => {
    const plan = await createTestPlan({ type: "OWNER", entitlements: [{ key: "max_locations", value: 1 }] }); // no trialDays override
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);

    const before = Date.now();
    const sub = await createSubscriptionForBusiness(business.id as string, plan.code, "monthly");
    const after = Date.now();

    expect(sub.status).toBe("trialing");
    expect(sub.planId.toString()).toBe(plan.id);
    expect(sub.trialStart!.getTime()).toBeGreaterThanOrEqual(before);
    expect(sub.trialStart!.getTime()).toBeLessThanOrEqual(after);

    const actualTrialMs = sub.trialEnd!.getTime() - sub.trialStart!.getTime();
    expect(actualTrialMs).toBe(env.TRIAL_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    expect(sub.currentPeriodEnd.getTime()).toBe(sub.trialEnd!.getTime());
  });

  it("a plan-specific trialDays override is honored instead of the env default", async () => {
    const plan = await createTestPlan({ type: "OWNER", trialDays: 3, entitlements: [{ key: "max_locations", value: 1 }] });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);

    const sub = await createSubscriptionForBusiness(business.id as string, plan.code, "monthly");
    const actualTrialMs = sub.trialEnd!.getTime() - sub.trialStart!.getTime();
    expect(actualTrialMs).toBe(3 * 24 * 60 * 60 * 1000);
  });

  it("the same mechanics apply identically to an agency trial", async () => {
    const plan = await createTestPlan({ type: "AGENCY", trialDays: 5, entitlements: [{ key: "max_businesses", value: 5 }] });
    planIds.push(plan.id);
    const agency = await createTestAgency();
    agencyIds.push(agency.id);

    const sub = await createSubscriptionForAgency(agency.id as string, plan.code, "monthly");
    expect(sub.status).toBe("trialing");
    const actualTrialMs = sub.trialEnd!.getTime() - sub.trialStart!.getTime();
    expect(actualTrialMs).toBe(5 * 24 * 60 * 60 * 1000);
  });
});

describe("resolveSubscriptionState — live / lapsed / never, exact boundary via explicit `now`", () => {
  it("a trialing subscription resolves 'live' right up to its boundary, then 'lapsed' — never silently 'never' (Phase 63's core safety property)", async () => {
    const plan = await createTestPlan({ type: "OWNER", entitlements: [{ key: "custom_domains", value: true }] });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const trialEnd = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now
    await createTestSubscription("business", business._id, plan._id, { status: "trialing", trialEnd, trialStart: new Date() });

    const justBefore = await resolveSubscriptionState("business", business.id as string, new Date(trialEnd.getTime() - 1));
    expect(justBefore.kind).toBe("live");

    const atBoundary = await resolveSubscriptionState("business", business.id as string, trialEnd);
    expect(atBoundary.kind).toBe("lapsed"); // NOT "never" — this owner has real subscription history
  });

  it("an owner who has NEVER had any real subscription resolves 'never', distinct from 'lapsed'", async () => {
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const state = await resolveSubscriptionState("business", business.id as string);
    expect(state.kind).toBe("never");
  });

  it("a provider:'internal' (grandfathered/comped) subscription is excluded from history — resolves 'never', not 'lapsed', matching the existing grandfathering guarantee", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    await createTestSubscription("business", business._id, plan._id, { status: "cancelled", provider: "internal" });

    const state = await resolveSubscriptionState("business", business.id as string);
    expect(state.kind).toBe("never");
  });
});

describe("runTrialExpirationSweep — the autonomous mechanism that was entirely missing before Phase 63", () => {
  it("transitions a genuinely-past-boundary trialing subscription to expired, and records billing history", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialStart: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      trialEnd: new Date(Date.now() - 1000), // 1 second in the real past
    });

    await runTrialExpirationSweep();

    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.status).toBe("expired");

    const history = await BillingHistoryEvent.findOne({ subscriptionId: sub._id, type: "expired" });
    expect(history).not.toBeNull();
  });

  it("does NOT touch a trialing subscription whose trialEnd is still in the future", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialEnd: new Date(Date.now() + 1000 * 60 * 60 * 24),
    });

    await runTrialExpirationSweep();
    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.status).toBe("trialing");
  });

  it("does NOT touch an already-converted (active) subscription, even though its historical trialEnd has long passed — a converted paid subscription is never incorrectly re-expired by stale trial logic", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "active", // already converted
      trialStart: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
      trialEnd: new Date(Date.now() - 26 * 24 * 60 * 60 * 1000), // long past — irrelevant now
    });

    await runTrialExpirationSweep();
    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.status).toBe("active");
  });

  it("is idempotent — running it twice against the same expired trial only records one billing-history event", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialEnd: new Date(Date.now() - 1000),
    });

    await runTrialExpirationSweep();
    await runTrialExpirationSweep(); // second tick — must be a safe no-op for this already-expired document

    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.status).toBe("expired");
    const historyCount = await BillingHistoryEvent.countDocuments({ subscriptionId: sub._id, type: "expired" });
    expect(historyCount).toBe(1);
  });

  it("never touches provider:'internal' (grandfathered) subscriptions, even with a stale trialEnd", async () => {
    const plan = await createTestPlan({ type: "OWNER" });
    planIds.push(plan.id);
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialEnd: new Date(Date.now() - 1000),
      provider: "internal",
    });

    await runTrialExpirationSweep();
    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.status).toBe("trialing");
  });
});
