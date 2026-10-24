import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { dispatchBillingLifecycleNotification } from "../queues/notification.queue.js";
import { closeTestConnections, createTestBusiness, createTestPlan, createTestSubscription, createTestUser } from "../test-utils/fixtures.js";
import { getEmailService } from "./index.js";
import type { EmailMessage } from "./EmailService.js";
import { trialEndingEmail } from "./templates.js";

/**
 * The trial reminder must not promise automatic billing that never happens: a GarnishTable trial
 * needs no card, so it simply ends (plan features pause, storefront/ordering continue). Only a
 * subscription already backed by the payment provider is billed when its trial ends.
 */
jest.setTimeout(30_000);

describe("trialEndingEmail", () => {
  const base = { planName: "Owner — Starter", trialEndsAt: "11/7/2026", billingUrl: "https://app.example.com/billing" };

  it("a no-card trial: says it won't be charged, what pauses, and that ordering keeps working", () => {
    const msg = trialEndingEmail("o@example.com", { ...base, autoRenews: false });
    for (const body of [msg.text, msg.html]) {
      expect(body).toContain("won't be charged automatically");
      expect(body).toContain("storefront and online ordering keep working");
      expect(body).not.toMatch(/billing begins automatically/);
    }
    expect(msg.subject).toBe("Your GarnishTable trial ends 11/7/2026");
  });

  it("a provider-backed (card on file) trial still says billing begins automatically", () => {
    const msg = trialEndingEmail("o@example.com", { ...base, autoRenews: true });
    expect(msg.text).toContain("billing begins automatically unless you cancel first");
    expect(msg.text).not.toContain("won't be charged automatically");
  });

  it("escapes the plan name in HTML", () => {
    expect(trialEndingEmail("o@example.com", { ...base, planName: "<b>x</b>", autoRenews: false }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("trial reminder dispatch", () => {
  const userIds: string[] = [];
  const businessIds: string[] = [];
  const planIds: string[] = [];

  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await Subscription.deleteMany({ ownerId: { $in: businessIds } });
    await Business.deleteMany({ _id: { $in: businessIds } });
    await Plan.deleteMany({ _id: { $in: planIds } });
    await User.deleteMany({ _id: { $in: userIds } });
    await closeTestConnections();
  });

  async function sentFor(overrides: Record<string, unknown>): Promise<EmailMessage> {
    const owner = await createTestUser("restaurant_owner");
    const business = await createTestBusiness({ ownerId: owner._id });
    const plan = await createTestPlan({ name: "Owner — Starter" });
    userIds.push(owner.id as string);
    businessIds.push(business.id);
    planIds.push(plan.id);
    const sub = await createTestSubscription("business", business._id, plan._id, {
      status: "trialing",
      trialEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      ...overrides,
    });
    const send = jest.spyOn(getEmailService(), "send").mockResolvedValue(undefined as never);
    try {
      await dispatchBillingLifecycleNotification({ ownerType: "business", ownerId: business.id, subscriptionId: sub.id, kind: "trial_ending" });
      expect(send).toHaveBeenCalledTimes(1);
      const msg = send.mock.calls[0][0] as EmailMessage;
      expect(msg.to).toBe(owner.email);
      return msg;
    } finally {
      send.mockRestore();
    }
  }

  it("a no-card trial gets the 'won't be charged automatically' reminder", async () => {
    const msg = await sentFor({});
    expect(msg.text).toContain("won't be charged automatically");
    expect(msg.text).not.toMatch(/billing begins automatically/);
  });

  it("a trial with a provider subscription gets the automatic-billing reminder", async () => {
    const msg = await sentFor({ providerSubscriptionId: "sub_test_card_on_file" });
    expect(msg.text).toContain("billing begins automatically");
  });
});
