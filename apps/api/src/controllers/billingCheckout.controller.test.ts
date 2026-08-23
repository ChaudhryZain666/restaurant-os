import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
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
