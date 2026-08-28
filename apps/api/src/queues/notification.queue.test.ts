import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { closeTestConnections, createTestBusiness, createTestPlan, createTestSubscription } from "../test-utils/fixtures.js";
import { notificationQueue, runTrialEndingReminderSweep } from "./notification.queue.js";

const businessIds: string[] = [];
const planIds: string[] = [];

beforeAll(async () => {
  await connectDB();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
  ]);
  await closeTestConnections();
});

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

/**
 * Phase 34 — runTrialEndingReminderSweep is the query/claim half of the daily trial-ending
 * reminder job (registerTrialReminderJob registers the BullMQ repeatable tick that calls it; that
 * scheduling wiring itself isn't unit-testable without a live queue tick, so this tests the sweep
 * function directly — the same pattern subscriptionBackfill.service.test.ts uses for its migration
 * function). Spies on notificationQueue.add rather than asserting real job delivery, since this
 * suite's concern is "did the sweep correctly decide who to remind and claim them," not BullMQ
 * itself.
 */
describe("runTrialEndingReminderSweep", () => {
  it("claims and enqueues a reminder for a trialing subscription ending within the window", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const business = await createTestBusiness();
    const plan = await createTestPlan();
    businessIds.push(business.id);
    planIds.push(plan.id);
    const sub = await createTestSubscription("business", business._id, plan._id, { status: "trialing", trialEnd: daysFromNow(2) });

    await runTrialEndingReminderSweep();

    expect(addSpy).toHaveBeenCalledWith(
      "billing.lifecycle",
      expect.objectContaining({ ownerType: "business", ownerId: business.id, subscriptionId: sub.id, kind: "trial_ending" })
    );
    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.trialEndingReminderSentAt).toBeTruthy();
  });

  it("does not claim a trialing subscription ending well outside the window", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const business = await createTestBusiness();
    const plan = await createTestPlan();
    businessIds.push(business.id);
    planIds.push(plan.id);
    const sub = await createTestSubscription("business", business._id, plan._id, { status: "trialing", trialEnd: daysFromNow(30) });

    await runTrialEndingReminderSweep();

    expect(addSpy).not.toHaveBeenCalledWith("billing.lifecycle", expect.objectContaining({ subscriptionId: sub.id }));
    const reloaded = await Subscription.findById(sub._id);
    expect(reloaded!.trialEndingReminderSentAt).toBeUndefined();
  });

  it("does not re-claim a subscription that was already reminded (idempotent across ticks)", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const business = await createTestBusiness();
    const plan = await createTestPlan();
    businessIds.push(business.id);
    planIds.push(plan.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialEnd: daysFromNow(1),
      trialEndingReminderSentAt: new Date(),
    });

    await runTrialEndingReminderSweep();

    expect(addSpy).not.toHaveBeenCalledWith("billing.lifecycle", expect.objectContaining({ subscriptionId: sub.id }));
  });

  it("ignores a non-trialing subscription even with a near trialEnd date", async () => {
    const addSpy = jest.spyOn(notificationQueue, "add").mockResolvedValue({} as never);
    const business = await createTestBusiness();
    const plan = await createTestPlan();
    businessIds.push(business.id);
    planIds.push(plan.id);
    const sub = await createTestSubscription("business", business._id, plan._id, { status: "active", trialEnd: daysFromNow(1) });

    await runTrialEndingReminderSweep();

    expect(addSpy).not.toHaveBeenCalledWith("billing.lifecycle", expect.objectContaining({ subscriptionId: sub.id }));
  });
});
