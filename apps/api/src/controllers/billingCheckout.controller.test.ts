import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { getMockBillingProvider } from "../billing/index.js";
import { connectDB } from "../config/db.js";
import { env } from "../config/env.js";
import { Agency } from "../models/Agency.js";
import { AgencyMembership } from "../models/AgencyMembership.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { Business } from "../models/Business.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestAgencyMembership,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];
const agencyIds: string[] = [];

afterAll(async () => {
  await Promise.all([
    BillingHistoryEvent.deleteMany({ ownerId: { $in: [...businessIds, ...agencyIds] } }),
    Subscription.deleteMany({ ownerId: { $in: [...businessIds, ...agencyIds] } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    AgencyMembership.deleteMany({ agencyId: { $in: agencyIds } }),
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
});

beforeAll(async () => {
  await connectDB();
});

describe("POST /businesses/:businessId/subscription/checkout — payment-method-up-front entry point", () => {
  it("rejects a plan with no providerPriceId configured for the interval", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan(); // no pricing at all
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);

    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(400);
  });

  it("creates NO Subscription document merely from launching checkout — only completion does", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_1" }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);

    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(200);
    expect(res.body.data.checkout.mode).toBe("redirect");
    expect(res.body.data.checkout.url).toEqual(expect.stringContaining("/mock-checkout/"));

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).toBeNull();
  });

  it("completing the mock checkout activates a real subscription via the real webhook path, and records billing history", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_1" }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);

    const checkoutRes = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    const token = (checkoutRes.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];

    const completeRes = await request(app).post(`/api/v1/billing/mock-checkout/${token}/complete`);
    expect(completeRes.status).toBe(200);

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("active");
    expect(stored!.provider).toBe("mock");

    const events = await BillingHistoryEvent.find({ ownerType: "business", ownerId: business._id }).sort({ occurredAt: 1 });
    expect(events.map((e) => e.type)).toEqual(["subscription_created", "payment_succeeded"]);
    expect(events[0].amountCents).toBe(7900);
    expect(events[0].currency).toBe("USD");
  });

  it("an unknown or already-completed checkout token is rejected cleanly, never a 500", async () => {
    const res = await request(app).post("/api/v1/billing/mock-checkout/not-a-real-token/complete");
    expect(res.status).toBe(400);
  });

  it("under true concurrency, two checkout sessions for the SAME business completing at once yield exactly one live subscription", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_1" }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    const authHeader = `Bearer ${tokenFor(owner)}`;

    // Both checkout SESSIONS are created before either completes — no subscription exists yet, so
    // createCheckoutSessionCore's own pre-check doesn't (and shouldn't) block this; the real race is
    // at COMPLETION, where the Subscription.create() insert races the partial unique index.
    const [sessionA, sessionB] = await Promise.all([
      request(app).post(`/api/v1/businesses/${business.id}/subscription/checkout`).set("Authorization", authHeader).send({
        planCode: plan.code,
        billingInterval: "monthly",
      }),
      request(app).post(`/api/v1/businesses/${business.id}/subscription/checkout`).set("Authorization", authHeader).send({
        planCode: plan.code,
        billingInterval: "monthly",
      }),
    ]);
    const tokenA = (sessionA.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];
    const tokenB = (sessionB.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];

    const [completeA, completeB] = await Promise.all([
      request(app).post(`/api/v1/billing/mock-checkout/${tokenA}/complete`),
      request(app).post(`/api/v1/billing/mock-checkout/${tokenB}/complete`),
    ]);
    // Both HTTP calls return 200 (webhook processing always acks receipt) — idempotency happens
    // INSIDE processBillingProviderEvent, not as an HTTP-level rejection, mirroring how a real
    // provider's webhook retry is handled everywhere else in this codebase.
    expect(completeA.status).toBe(200);
    expect(completeB.status).toBe(200);

    const count = await Subscription.countDocuments({ ownerType: "business", ownerId: business._id, status: { $in: ["trialing", "active"] } });
    expect(count).toBe(1);
  });
});

describe("GET /businesses/:businessId/subscription/billing-history — isolation", () => {
  it("a cross-business owner cannot read this business's billing history", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const otherBusiness = await createTestBusiness();
    const otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });
    const otherOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
    businessIds.push(business.id, otherBusiness.id);
    restaurantIds.push(location.id, otherLocation.id);
    userIds.push(owner.id as string, otherOwner.id as string);

    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription/billing-history`)
      .set("Authorization", `Bearer ${tokenFor(otherOwner)}`);
    expect(res.status).toBe(403);

    const ownRes = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription/billing-history`)
      .set("Authorization", `Bearer ${tokenFor(owner)}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.data.items).toEqual([]);
  });
});

describe("Agency checkout — mirrors the business flow, isolated per agency", () => {
  it("agency_owner can launch and complete an agency checkout; a different agency never sees its billing history", async () => {
    const agency = await createTestAgency();
    const otherAgency = await createTestAgency();
    const ownerUser = await createTestUser("agency_member");
    const otherOwner = await createTestUser("agency_member");
    agencyIds.push(agency.id, otherAgency.id);
    userIds.push(ownerUser.id, otherOwner.id);
    await createTestAgencyMembership(agency._id, ownerUser._id, { role: "agency_owner" });
    await createTestAgencyMembership(otherAgency._id, otherOwner._id, { role: "agency_owner" });
    const ownerToken = tokenFor(ownerUser, [{ agencyId: agency.id, role: "agency_owner" }]);
    const otherToken = tokenFor(otherOwner, [{ agencyId: otherAgency.id, role: "agency_owner" }]);

    const plan = await createTestPlan({
      type: "AGENCY",
      pricing: [{ interval: "monthly", amountCents: 19900, currency: "USD", providerPriceId: "mock_price_agency" }],
    });
    planIds.push(plan.id);

    const checkoutRes = await request(app)
      .post(`/api/v1/agencies/${agency.id}/subscription/checkout`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(checkoutRes.status).toBe(200);
    const token = (checkoutRes.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];

    await request(app).post(`/api/v1/billing/mock-checkout/${token}/complete`).expect(200);

    const stored = await Subscription.findOne({ ownerType: "agency", ownerId: agency._id });
    expect(stored!.status).toBe("active");

    const crossRes = await request(app)
      .get(`/api/v1/agencies/${agency.id}/subscription/billing-history`)
      .set("Authorization", `Bearer ${otherToken}`);
    expect(crossRes.status).toBe(403);

    const ownRes = await request(app)
      .get(`/api/v1/agencies/${agency.id}/subscription/billing-history`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(ownRes.status).toBe(200);
    expect(ownRes.body.data.items.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * Phase 40.3 — real, live-verified finding: createCheckoutSessionCore called provider.createCustomer
 * unconditionally on every checkout attempt, which against a real Paddle account hits an actual 409
 * `customer_already_exists` on any retry (abandoned first attempt, or checkout after a prior
 * cancellation) — Paddle enforces one customer per email. Fixed by making createCustomer idempotent
 * per email at the provider level (PaddleBillingProvider.ts / MockBillingProvider.ts, both proven
 * individually in their own unit tests); these are the integration-level proofs that the real
 * checkout HTTP path benefits from that fix, exercised through the exact code path a real retry
 * would take.
 */
describe("checkout provider-customer reuse — the real 409 class of bug", () => {
  it("a second checkout attempt after an abandoned first one reuses the same provider customer, not a new one", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    business.ownerId = owner._id; // resolveOwnerIdentity reads this to find the real owner email
    await business.save();
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_1" }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    const authHeader = `Bearer ${tokenFor(owner)}`;

    // Attempt 1 — abandoned: launches checkout (which, under the hood, calls provider.createCustomer)
    // but is never completed, exactly like a real customer closing the tab.
    const abandoned = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", authHeader)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(abandoned.status).toBe(200);

    // Attempt 2 — the real retry. Before the fix, this call's own provider.createCustomer would have
    // been a real second create for the same email — the exact shape of the live Paddle 409 this
    // phase found and reproduced against the real sandbox API.
    const retry = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", authHeader)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(retry.status).toBe(200);

    const token = (retry.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];
    await request(app).post(`/api/v1/billing/mock-checkout/${token}/complete`).expect(200);

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(stored).not.toBeNull();

    // Proof of reuse: calling createCustomer again for this exact owner/email now returns the SAME
    // provider customer id createCheckoutSessionCore already resolved to above — if the retry had
    // instead created a second, orphaned customer, this would come back with a third, different id.
    const reResolved = await getMockBillingProvider().createCustomer({
      ownerType: "business",
      ownerId: business.id as string,
      email: owner.email!,
      name: owner.name!,
    });
    expect(reResolved.providerCustomerId).toBe(stored!.providerCustomerId);
  });

  it("cancelling then re-subscribing reuses the same provider customer across the new subscription", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    business.ownerId = owner._id; // resolveOwnerIdentity reads this to find the real owner email
    await business.save();
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 7900, currency: "USD", providerPriceId: "mock_price_1" }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    const authHeader = `Bearer ${tokenFor(owner)}`;

    const firstCheckout = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", authHeader)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    const firstToken = (firstCheckout.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];
    await request(app).post(`/api/v1/billing/mock-checkout/${firstToken}/complete`).expect(200);
    const firstSub = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    const firstCustomerId = firstSub!.providerCustomerId;
    expect(firstCustomerId).toBeDefined();

    // Cancel immediately (not at period end), matching subscription.service.ts's own semantics for
    // an immediate cancellation, so a second checkout is allowed right away.
    await Subscription.updateOne({ _id: firstSub!._id }, { $set: { status: "cancelled", cancelledAt: new Date() } });

    const secondCheckout = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", authHeader)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(secondCheckout.status).toBe(200);
    const secondToken = (secondCheckout.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];
    await request(app).post(`/api/v1/billing/mock-checkout/${secondToken}/complete`).expect(200);

    const secondSub = await Subscription.findOne({ ownerType: "business", ownerId: business._id, status: "active" });
    expect(secondSub!.id).not.toBe(firstSub!.id); // a genuinely new subscription document
    expect(secondSub!.providerCustomerId).toBe(firstCustomerId); // but the SAME provider customer

    const historyCount = await Subscription.countDocuments({ ownerType: "business", ownerId: business._id });
    expect(historyCount).toBe(2); // the cancelled row is kept, not deleted
  });

  it("two different local owners who happen to share an email are never silently merged into one provider customer", async () => {
    const sharedEmail = `shared-${Date.now()}@test.local`;
    const business = await createTestBusiness();
    businessIds.push(business.id);
    const otherAgency = await createTestAgency({ contactEmail: sharedEmail });
    agencyIds.push(otherAgency.id);

    const provider = getMockBillingProvider();
    const businessCustomer = await provider.createCustomer({
      ownerType: "business",
      ownerId: business.id as string,
      email: sharedEmail,
      name: "Shared Email Business",
    });
    expect(businessCustomer.providerCustomerId).toBeDefined();

    // A DIFFERENT owner (an agency) resolving to the exact same email must never receive the
    // business's customer id back — that would misattribute one owner's billing identity to another.
    await expect(
      provider.createCustomer({ ownerType: "agency", ownerId: otherAgency.id as string, email: sharedEmail, name: "Shared Email Agency" })
    ).rejects.toThrow(/different owner/);
  });
});

describe("POST /businesses/:businessId/subscription/checkout — a no-card trial converts on its own plan (Phase 89)", () => {
  it("refuses a different plan or interval before any provider call, and still allows the trial's own", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const starter = await createTestPlan({
      trialDays: 14,
      pricing: [
        { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: "mock_price_starter_m" },
        { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: "mock_price_starter_y" },
      ],
    });
    const growth = await createTestPlan({
      trialDays: 14,
      pricing: [{ interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: "mock_price_growth_m" }],
    });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(starter.id, growth.id);
    const auth = `Bearer ${tokenFor(owner)}`;

    const trial = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", auth)
      .send({ planCode: starter.code, billingInterval: "monthly" });
    expect(trial.status).toBe(201);
    const before = await Subscription.findOne({ ownerType: "business", ownerId: business._id }).lean();
    expect(before?.status).toBe("trialing");
    expect(before?.providerSubscriptionId).toBeUndefined();

    const createCustomer = jest.spyOn(getMockBillingProvider(), "createCustomer");
    try {
      for (const body of [
        { planCode: growth.code, billingInterval: "monthly" },
        { planCode: starter.code, billingInterval: "yearly" },
      ]) {
        const res = await request(app).post(`/api/v1/businesses/${business.id}/subscription/checkout`).set("Authorization", auth).send(body);
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/trial's current plan and billing interval/);
      }
      expect(createCustomer).not.toHaveBeenCalled();

      const own = await request(app)
        .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
        .set("Authorization", auth)
        .send({ planCode: starter.code, billingInterval: "monthly" });
      expect(own.status).toBe(200);
      expect(own.body.data.checkout.mode).toBe("redirect");
      expect(createCustomer).toHaveBeenCalledTimes(1);
    } finally {
      createCustomer.mockRestore();
    }

    // Launching (or refusing) checkout changes nothing locally.
    const after = await Subscription.findOne({ ownerType: "business", ownerId: business._id }).lean();
    expect(String(after?.planId)).toBe(String(starter._id));
    expect(after?.billingInterval).toBe("monthly");
    expect(after?.status).toBe("trialing");
  });
});

describe("billing history for a no-card trial (Phase 89)", () => {
  it("records the trial start without a charge, and a later real payment with its actual amount", async () => {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({
      trialDays: 14,
      pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: "mock_price_trial_history" }],
    });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    const auth = `Bearer ${tokenFor(owner)}`;

    // 1. No-card trial: one "trial_started" row, no amount — never a $59 "subscription started".
    const trial = await request(app).post(`/api/v1/businesses/${business.id}/subscription`).set("Authorization", auth).send({ planCode: plan.code, billingInterval: "monthly" });
    expect(trial.status).toBe(201);
    const afterTrial = await BillingHistoryEvent.find({ ownerType: "business", ownerId: business._id }).lean();
    expect(afterTrial.map((e) => e.type)).toEqual(["trial_started"]);
    expect(afterTrial[0].amountCents).toBeUndefined();
    expect(afterTrial[0].currency).toBeUndefined();
    const historyRes = await request(app).get(`/api/v1/businesses/${business.id}/subscription/billing-history`).set("Authorization", auth);
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.data.items).toHaveLength(1);
    expect(historyRes.body.data.items[0].type).toBe("trial_started");
    expect(historyRes.body.data.items[0].amountCents).toBeUndefined();

    // 2. The owner subscribes early: the real payment row carries the actual amount.
    const checkoutRes = await request(app).post(`/api/v1/businesses/${business.id}/subscription/checkout`).set("Authorization", auth).send({ planCode: plan.code, billingInterval: "monthly" });
    expect(checkoutRes.status).toBe(200);
    const token = (checkoutRes.body.data.checkout.url as string).split("/mock-checkout/")[1].split("?")[0];
    expect((await request(app).post(`/api/v1/billing/mock-checkout/${token}/complete`)).status).toBe(200);

    const subscription = await Subscription.findOne({ ownerType: "business", ownerId: business._id }).lean();
    expect(subscription?.status).toBe("active");
    expect(subscription?.trialEnd).toBeUndefined();
    const afterPayment = await BillingHistoryEvent.find({ ownerType: "business", ownerId: business._id }).sort({ occurredAt: 1, _id: 1 }).lean();
    expect(afterPayment.map((e) => e.type)).toEqual(["trial_started", "subscription_created", "payment_succeeded"]);
    const payment = afterPayment.find((e) => e.type === "payment_succeeded");
    expect(payment?.amountCents).toBe(5900);
    expect(payment?.currency).toBe("USD");

    // 3. A repeated completion is refused and changes nothing.
    expect((await request(app).post(`/api/v1/billing/mock-checkout/${token}/complete`)).status).not.toBe(200);
    expect(await BillingHistoryEvent.countDocuments({ ownerType: "business", ownerId: business._id })).toBe(3);
    expect(await Subscription.countDocuments({ ownerType: "business", ownerId: business._id, status: { $in: ["trialing", "active", "past_due", "cancelling"] } })).toBe(1);
  });
});

describe("checkout launch guards (pre-launch)", () => {
  async function ownerWithPlan(providerPriceId: string) {
    const business = await createTestBusiness();
    const location = await createTestRestaurant({ businessId: business._id });
    const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
    const plan = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId }] });
    businessIds.push(business.id);
    restaurantIds.push(location.id);
    userIds.push(owner.id as string);
    planIds.push(plan.id);
    const checkout = () =>
      request(app)
        .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
        .set("Authorization", `Bearer ${tokenFor(owner)}`)
        .send({ planCode: plan.code, billingInterval: "monthly" });
    return { checkout };
  }

  it("BILLING_CHECKOUT_ENABLED=false pauses new paid checkouts before any provider call", async () => {
    const { checkout } = await ownerWithPlan("mock_price_paused_m");
    const createCustomer = jest.spyOn(getMockBillingProvider(), "createCustomer");
    const saved = env.BILLING_CHECKOUT_ENABLED;
    env.BILLING_CHECKOUT_ENABLED = false;
    try {
      const res = await checkout();
      expect(res.status).toBe(503);
      expect(res.body.error.message).toMatch(/paused/);
      expect(createCustomer).not.toHaveBeenCalled();
    } finally {
      env.BILLING_CHECKOUT_ENABLED = saved;
      createCustomer.mockRestore();
    }
    expect((await checkout()).status).toBe(200); // back on: checkout works again
  });

  it("under Paddle, a plan still carrying a seeded mock_price_* placeholder is refused before any Paddle call", async () => {
    const { checkout } = await ownerWithPlan("mock_price_not_loaded_m");
    const provider = getMockBillingProvider();
    const createCustomer = jest.spyOn(provider, "createCustomer");
    Object.defineProperty(provider, "name", { value: "paddle", configurable: true });
    try {
      const res = await checkout();
      expect(res.status).toBe(503);
      expect(res.body.error.message).toMatch(/isn't available yet/);
      expect(createCustomer).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(provider, "name", { value: "mock", configurable: true });
      createCustomer.mockRestore();
    }
  });
});
