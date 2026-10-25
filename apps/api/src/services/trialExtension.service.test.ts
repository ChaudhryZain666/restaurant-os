import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import type mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { notificationQueue, runTrialEndingReminderSweep } from "../queues/notification.queue.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";
import { hasFeatureEntitlement } from "./entitlementLimit.service.js";
import { runTrialExpirationSweep } from "./subscription.service.js";
import { isSubscriptionLive } from "./subscriptionResolution.service.js";
import { paidCheckoutAvailable, trialExtensionActive } from "./trialExtension.service.js";

/**
 * Pre-launch — no-card trials don't lapse while production can't take payment (BILLING_PROVIDER=mock
 * in production), and hand back to normal expiry, with a grace period, once checkout opens. The test
 * environment allows mock drivers (checkout "available"), so each test sets the production-like
 * condition explicitly and restores it.
 */
jest.setTimeout(30_000);

const DAY = 24 * 60 * 60 * 1000;
const saved = {
  nodeEnv: env.NODE_ENV,
  provider: env.BILLING_PROVIDER,
  flag: env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE,
  grace: env.TRIAL_GRACE_AFTER_CHECKOUT_OPENS_DAYS,
};
function productionWithoutCheckout() {
  env.NODE_ENV = "production";
  env.BILLING_PROVIDER = "mock";
  env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = true;
}
function checkoutOpen() {
  env.NODE_ENV = "production";
  env.BILLING_PROVIDER = "paddle";
}
afterEach(() => {
  env.NODE_ENV = saved.nodeEnv;
  env.BILLING_PROVIDER = saved.provider;
  env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = saved.flag;
  env.TRIAL_GRACE_AFTER_CHECKOUT_OPENS_DAYS = saved.grace;
});

const businessIds: string[] = [];
const planIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
let plan: Awaited<ReturnType<typeof createTestPlan>>;

beforeAll(async () => {
  await connectDB();
  plan = await createTestPlan(); // entitlements include custom_domains/business_analytics/business_promotions
  planIds.push(plan.id);
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
  ]);
  await closeTestConnections();
});

async function trialFor(overrides: Record<string, unknown> = {}) {
  const business = await createTestBusiness();
  businessIds.push(business.id);
  const trialStart = new Date(Date.now() - 20 * DAY);
  const sub = await createTestSubscription("business", business._id as mongoose.Types.ObjectId, plan._id as mongoose.Types.ObjectId, {
    status: "trialing",
    trialStart,
    trialEnd: new Date(Date.now() - 6 * DAY), // ended 6 days ago
    currentPeriodStart: trialStart,
    currentPeriodEnd: new Date(Date.now() - 6 * DAY),
    ...overrides,
  });
  return { business, sub };
}

describe("when the extension applies", () => {
  it("only in production without a real billing provider, and only while the flag is on", () => {
    expect(trialExtensionActive()).toBe(false); // test env: mock drivers allowed — checkout "available"
    productionWithoutCheckout();
    expect(paidCheckoutAvailable()).toBe(false);
    expect(trialExtensionActive()).toBe(true);
    env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = false;
    expect(trialExtensionActive()).toBe(false);
    checkoutOpen();
    env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = true;
    expect(paidCheckoutAvailable()).toBe(true);
    expect(trialExtensionActive()).toBe(false);
  });
});

describe("trial liveness and feature access", () => {
  it("a no-card trial past its end stays live — features included — while checkout is unavailable", async () => {
    const { business, sub } = await trialFor();
    productionWithoutCheckout();
    expect(isSubscriptionLive(sub)).toBe(true);
    expect(await hasFeatureEntitlement("business", business.id, "custom_domains")).toBe(true);
  });

  it("without the extension (flag off, or checkout open) the same trial has lapsed", async () => {
    const { business, sub } = await trialFor();
    productionWithoutCheckout();
    env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = false;
    expect(isSubscriptionLive(sub)).toBe(false);
    expect(await hasFeatureEntitlement("business", business.id, "custom_domains")).toBe(false);
    checkoutOpen();
    expect(isSubscriptionLive(sub)).toBe(false);
  });

  it("a trial with a provider subscription (card on file) is never extended", async () => {
    const { sub } = await trialFor({ providerSubscriptionId: "sub_card_on_file", provider: "paddle" });
    productionWithoutCheckout();
    expect(isSubscriptionLive(sub)).toBe(false);
  });
});

describe("runTrialExpirationSweep", () => {
  it("while checkout is unavailable: holds a no-card trial (recorded once, nothing reset), expires card-backed ones, leaves paid subscriptions alone", async () => {
    const { sub: held } = await trialFor();
    const { sub: carded } = await trialFor({ providerSubscriptionId: "sub_carded_1", provider: "paddle" });
    const { sub: paid } = await trialFor({ status: "active", trialEnd: undefined, trialStart: undefined });
    productionWithoutCheckout();

    await runTrialExpirationSweep();
    const h = (await Subscription.findById(held._id))!;
    expect(h.status).toBe("trialing");
    expect(h.trialStart!.getTime()).toBe(held.trialStart!.getTime());
    expect(h.trialEnd!.getTime()).toBe(held.trialEnd!.getTime());
    expect(h.trialExtension!.originalTrialEnd!.getTime()).toBe(held.trialEnd!.getTime());
    const firstExtendedAt = h.trialExtension!.extendedAt!.getTime();

    expect((await Subscription.findById(carded._id))!.status).toBe("expired");
    const p = (await Subscription.findById(paid._id))!;
    expect(p.status).toBe("active");
    expect(p.trialExtension).toBeUndefined();

    await runTrialExpirationSweep(); // idempotent
    expect((await Subscription.findById(held._id))!.trialExtension!.extendedAt!.getTime()).toBe(firstExtendedAt);
  });

  it("when checkout opens: each held trial gets the grace (and a fresh reminder), then normal expiry resumes", async () => {
    const { business, sub } = await trialFor({ trialEndingReminderSentAt: new Date(Date.now() - 9 * DAY) });
    productionWithoutCheckout();
    await runTrialExpirationSweep(); // held

    checkoutOpen();
    env.TRIAL_GRACE_AFTER_CHECKOUT_OPENS_DAYS = 7;
    const before = Date.now();
    await runTrialExpirationSweep();
    let s = (await Subscription.findById(sub._id))!;
    expect(s.status).toBe("trialing");
    expect(s.trialEnd!.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY - 1000);
    expect(s.trialEnd!.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY + 1000);
    expect(s.trialExtension!.endedAt).toBeDefined();
    expect(s.trialExtension!.originalTrialEnd!.getTime()).toBe(sub.trialEnd!.getTime()); // history kept
    expect(s.trialStart!.getTime()).toBe(sub.trialStart!.getTime());
    expect(s.trialEndingReminderSentAt).toBeUndefined(); // will be reminded before the grace ends
    expect(isSubscriptionLive(s)).toBe(true);
    expect(await hasFeatureEntitlement("business", business.id, "custom_domains")).toBe(true);

    // Grace over → expires like any trial, and is never held again.
    await Subscription.updateOne({ _id: sub._id }, { $set: { trialEnd: new Date(Date.now() - 1000) } });
    await runTrialExpirationSweep();
    s = (await Subscription.findById(sub._id))!;
    expect(s.status).toBe("expired");
    expect(await hasFeatureEntitlement("business", business.id, "custom_domains")).toBe(false);
  });

  it("rollback (flag off while checkout is still unavailable) also hands back with the grace, never an instant cut-off", async () => {
    const { sub } = await trialFor();
    productionWithoutCheckout();
    await runTrialExpirationSweep();
    env.TRIAL_EXTENSION_WHILE_CHECKOUT_UNAVAILABLE = false;
    await runTrialExpirationSweep();
    const s = (await Subscription.findById(sub._id))!;
    expect(s.status).toBe("trialing");
    expect(s.trialEnd!.getTime()).toBeGreaterThan(Date.now() + 6 * DAY);
  });

  it("a trial that hasn't reached its end yet is untouched by the extension", async () => {
    const { sub } = await trialFor({ trialEnd: new Date(Date.now() + 5 * DAY) });
    productionWithoutCheckout();
    await runTrialExpirationSweep();
    const s = (await Subscription.findById(sub._id))!;
    expect(s.trialExtension).toBeUndefined();
    expect(s.trialEnd!.getTime()).toBe(sub.trialEnd!.getTime());
  });
});

describe("trial-ending reminders", () => {
  it("are not sent for a no-card trial while it's extended; a card-backed trial is still reminded", async () => {
    const { sub: noCard } = await trialFor({ trialEnd: new Date(Date.now() + 2 * DAY) });
    const { sub: carded } = await trialFor({ trialEnd: new Date(Date.now() + 2 * DAY), providerSubscriptionId: "sub_carded_2", provider: "paddle" });
    const add = jest.spyOn(notificationQueue, "add").mockResolvedValue(undefined as never);
    productionWithoutCheckout();
    try {
      await runTrialEndingReminderSweep();
      const ids = add.mock.calls.map((c) => (c[1] as { subscriptionId: string }).subscriptionId);
      expect(ids).toContain(carded.id);
      expect(ids).not.toContain(noCard.id);
      expect((await Subscription.findById(noCard._id))!.trialEndingReminderSentAt).toBeUndefined();
    } finally {
      add.mockRestore();
    }
  });
});

describe("GET /businesses/:id/subscription", () => {
  it("tells the owner the trial is extended while checkout is unavailable", async () => {
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const restaurant = await createTestRestaurant({ businessId: business._id });
    restaurantIds.push(restaurant.id);
    const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
    userIds.push(owner.id as string);
    await Business.updateOne({ _id: business._id }, { $set: { ownerId: owner._id } });
    await createTestSubscription("business", business._id as mongoose.Types.ObjectId, plan._id as mongoose.Types.ObjectId, {
      status: "trialing",
      trialEnd: new Date(Date.now() + 3 * DAY),
    });
    const app = createApp();
    const get = () => request(app).get(`/api/v1/businesses/${business.id}/subscription`).set("Authorization", `Bearer ${tokenFor(owner)}`);

    const normal = await get();
    expect(normal.status).toBe(200);
    expect(normal.body.data.trialExtended).toBe(false);

    productionWithoutCheckout(); // NODE_ENV=production + mock billing: checkout unavailable
    const extended = await get();
    expect(extended.status).toBe(200);
    expect(extended.body.data.trialExtended).toBe(true);
  });
});
