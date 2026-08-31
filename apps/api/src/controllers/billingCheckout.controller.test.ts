import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { getMockBillingProvider } from "../billing/index.js";
import { connectDB } from "../config/db.js";
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
    const token = (checkoutRes.body.data.checkout.url as string).split("/mock-checkout/")[1];

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
    const tokenA = (sessionA.body.data.checkout.url as string).split("/mock-checkout/")[1];
    const tokenB = (sessionB.body.data.checkout.url as string).split("/mock-checkout/")[1];

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
    const token = (checkoutRes.body.data.checkout.url as string).split("/mock-checkout/")[1];

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

    const token = (retry.body.data.checkout.url as string).split("/mock-checkout/")[1];
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
    const firstToken = (firstCheckout.body.data.checkout.url as string).split("/mock-checkout/")[1];
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
    const secondToken = (secondCheckout.body.data.checkout.url as string).split("/mock-checkout/")[1];
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
