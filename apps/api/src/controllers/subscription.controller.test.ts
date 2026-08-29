import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { getMockBillingProvider } from "../billing/index.js";
import {
  closeTestConnections,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let business: Awaited<ReturnType<typeof createTestBusiness>>;
let location: Awaited<ReturnType<typeof createTestRestaurant>>;
let otherBusiness: Awaited<ReturnType<typeof createTestBusiness>>;
let otherLocation: Awaited<ReturnType<typeof createTestRestaurant>>;
let raceBusiness: Awaited<ReturnType<typeof createTestBusiness>>;

let plan: Awaited<ReturnType<typeof createTestPlan>>;
let planTwo: Awaited<ReturnType<typeof createTestPlan>>;
let inactivePlan: Awaited<ReturnType<typeof createTestPlan>>;

let ownerToken: string;
let managerToken: string;
let staffToken: string;
let crossBusinessOwnerToken: string;
let raceOwnerToken: string;
let platformAdminToken: string;
let customerId: string;

const businessIds: string[] = [];
const restaurantIds: string[] = [];
const userIds: string[] = [];
const planIds: string[] = [];

beforeAll(async () => {
  await connectDB();

  business = await createTestBusiness();
  location = await createTestRestaurant({ businessId: business._id });
  otherBusiness = await createTestBusiness();
  otherLocation = await createTestRestaurant({ businessId: otherBusiness._id });
  raceBusiness = await createTestBusiness();
  await createTestRestaurant({ businessId: raceBusiness._id });

  plan = await createTestPlan({ code: `owner-test-${Date.now()}` });
  planTwo = await createTestPlan({ code: `owner-test-2-${Date.now()}` });
  inactivePlan = await createTestPlan({ code: `owner-test-inactive-${Date.now()}`, isActive: false });

  businessIds.push(business.id, otherBusiness.id, raceBusiness.id);
  restaurantIds.push(location.id, otherLocation.id);
  planIds.push(plan.id, planTwo.id, inactivePlan.id);

  const owner = await createTestUser("restaurant_owner", location._id, { businessId: business._id });
  const manager = await createTestUser("restaurant_manager", location._id, { businessId: business._id });
  const staff = await createTestUser("restaurant_staff", location._id, { businessId: business._id, locationIds: [location._id] });
  const crossBusinessOwner = await createTestUser("restaurant_owner", otherLocation._id, { businessId: otherBusiness._id });
  const raceOwner = await createTestUser("restaurant_owner", undefined, { businessId: raceBusiness._id });
  const platformAdmin = await createTestUser("platform_admin");
  const customer = await createTestUser("customer");

  userIds.push(owner.id, manager.id, staff.id, crossBusinessOwner.id, raceOwner.id, platformAdmin.id, customer.id);

  ownerToken = tokenFor(owner);
  managerToken = tokenFor(manager);
  staffToken = tokenFor(staff);
  crossBusinessOwnerToken = tokenFor(crossBusinessOwner);
  raceOwnerToken = tokenFor(raceOwner);
  platformAdminToken = tokenFor(platformAdmin);
  customerId = customer.id as string;
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerType: "business", ownerId: { $in: businessIds } }),
    AuditLog.deleteMany({ restaurantId: { $in: restaurantIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
  ]);
  await User.deleteOne({ _id: customerId });
  await closeTestConnections();
});

describe("POST /businesses/:businessId/subscription — creation + authorization", () => {
  it("owner can start a subscription (mock provider, default trial => trialing)", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });

    expect(res.status).toBe(201);
    expect(res.body.data.subscription.status).toBe("trialing");
    expect(res.body.data.subscription.provider).toBe("mock");
    expect(res.body.data.plan.code).toBe(plan.code);
  });

  it("a second create attempt for the same business is rejected — only one live subscription per business", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(409);
  });

  it("rejects an unknown plan code", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${otherBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ planCode: "does-not-exist", billingInterval: "monthly" });
    expect(res.status).toBe(400);
  });

  it("rejects an inactive plan code", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${otherBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ planCode: inactivePlan.code, billingInterval: "monthly" });
    expect(res.status).toBe(400);
  });

  it("rejects an AGENCY-type plan — a business account can't be assigned an agency plan (Phase 37 fix)", async () => {
    const agencyPlan = await createTestPlan({ code: `agency-only-${Date.now()}`, type: "AGENCY" });
    planIds.push(agencyPlan.id);
    const res = await request(app)
      .post(`/api/v1/businesses/${otherBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ planCode: agencyPlan.code, billingInterval: "monthly" });
    expect(res.status).toBe(400);
    const created = await Subscription.findOne({ ownerType: "business", ownerId: otherBusiness.id });
    expect(created).toBeNull();
  });

  it("manager cannot create a subscription (billing.manage is owner-only)", async () => {
    const managerAttempt = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(managerAttempt.status).toBe(403);
  });

  it("a cross-business owner cannot create a subscription for this business", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(res.status).toBe(401);
  });

  it("writes an audit entry fanned out to every restaurant under the business", async () => {
    const entry = await AuditLog.findOne({ restaurantId: location._id, action: "subscription.created" });
    expect(entry).not.toBeNull();
    expect(entry?.targetType).toBe("subscription");
  });
});

describe("GET /businesses/:businessId/subscription and /entitlements — visibility", () => {
  it("owner and manager (billing.read) can view the subscription", async () => {
    const asOwner = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.data.subscription.status).toBe("trialing");

    const asManager = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(asManager.status).toBe(200);
  });

  it("staff cannot view billing (no billing.read)", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(res.status).toBe(403);
  });

  it("a cross-business owner cannot view this business's subscription", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(res.status).toBe(403);
  });

  it("returns null (not an error) for a business with no subscription", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${otherBusiness.id}/subscription`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toBeNull();
  });

  it("entitlements reflect the plan's own entitlement keys", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription/entitlements`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.entitlements.custom_domains).toBe(true);
    expect(res.body.data.entitlements.some_key_that_does_not_exist).toBeUndefined();
  });

  it("404s entitlements for a business with no subscription", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${otherBusiness.id}/subscription/entitlements`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(res.status).toBe(404);
  });
});

describe("subscription lifecycle — cancel / reactivate / change-plan", () => {
  it("cancelling a still-trialing subscription cancels immediately — no billing period to wait for", async () => {
    const trialBiz = await createTestBusiness();
    const trialLoc = await createTestRestaurant({ businessId: trialBiz._id });
    const trialOwner = await createTestUser("restaurant_owner", trialLoc._id, { businessId: trialBiz._id });
    businessIds.push(trialBiz.id);
    restaurantIds.push(trialLoc.id);
    userIds.push(trialOwner.id as string);
    const trialOwnerToken = tokenFor(trialOwner);

    const createRes = await request(app)
      .post(`/api/v1/businesses/${trialBiz.id}/subscription`)
      .set("Authorization", `Bearer ${trialOwnerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(createRes.body.data.subscription.status).toBe("trialing");

    const res = await request(app)
      .post(`/api/v1/businesses/${trialBiz.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${trialOwnerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("cancelled");
    expect(res.body.data.subscription.cancelledAt).toEqual(expect.any(String));
    expect(res.body.data.subscription.cancelAt).toBeUndefined();
  });

  it("owner can schedule cancellation on an ACTIVE subscription (active -> cancelling), and staff/manager cannot", async () => {
    // Promote business's subscription out of its initial trial the way a real trial conversion
    // would (a webhook reporting the provider's own "active" status) — done directly here since
    // this test's subject is the cancel/reactivate lifecycle, not trial conversion itself.
    await Subscription.findOneAndUpdate({ ownerType: "business", ownerId: business._id }, { $set: { status: "active" } });

    const staffAttempt = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(staffAttempt.status).toBe(403);

    const managerAttempt = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(managerAttempt.status).toBe(403);

    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("cancelling");
    expect(res.body.data.subscription.cancelAt).toEqual(expect.any(String));
  });

  it("cancelling again (already cancelling) is rejected as an invalid transition", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(400);
  });

  it("owner can reactivate (cancelling -> active)", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/reactivate`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("active");
    expect(res.body.data.subscription.cancelAt).toBeUndefined();
  });

  it("owner can change plan while active", async () => {
    const res = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/change-plan`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: planTwo.code });
    expect(res.status).toBe(200);
    expect(res.body.data.plan.code).toBe(planTwo.code);
  });

  it("a cross-business owner cannot cancel/reactivate/change-plan this business's subscription", async () => {
    const cancel = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/cancel`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`);
    expect(cancel.status).toBe(403);

    const changePlan = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/change-plan`)
      .set("Authorization", `Bearer ${crossBusinessOwnerToken}`)
      .send({ planCode: plan.code });
    expect(changePlan.status).toBe(403);
  });

  it("fully cancelling then re-subscribing creates a NEW subscription document, never resurrecting the old one", async () => {
    await request(app).post(`/api/v1/businesses/${business.id}/subscription/cancel`).set("Authorization", `Bearer ${ownerToken}`);
    const cancelled = await Subscription.findOneAndUpdate(
      { ownerType: "business", ownerId: business._id, status: "cancelling" },
      { $set: { status: "cancelled", cancelledAt: new Date() } },
      { new: true }
    );
    expect(cancelled).not.toBeNull();

    const resubscribe = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: plan.code, billingInterval: "monthly" });
    expect(resubscribe.status).toBe(201);
    expect(resubscribe.body.data.subscription.id).not.toBe(cancelled!.id);

    const historyCount = await Subscription.countDocuments({ ownerType: "business", ownerId: business._id });
    expect(historyCount).toBe(2); // the old cancelled row is kept, not deleted
  });
});

describe("POST /businesses/:businessId/subscription/mock-advance — dev-only trial conversion driver", () => {
  it("owner can drive a real signed event through the same path a genuine webhook would use", async () => {
    const biz = await createTestBusiness();
    const loc = await createTestRestaurant({ businessId: biz._id });
    const owner = await createTestUser("restaurant_owner", loc._id, { businessId: biz._id });
    const staff = await createTestUser("restaurant_staff", loc._id, { businessId: biz._id, locationIds: [loc._id] });
    businessIds.push(biz.id);
    restaurantIds.push(loc.id);
    userIds.push(owner.id as string, staff.id as string);
    const token = tokenFor(owner);

    // Phase 34 closure — the no-card-trial create path no longer contacts the billing provider at
    // all (real Paddle has no direct-create endpoint), so mock-advance needs a subscription that
    // already has a real provider link, exactly like an owner who added a card during their trial.
    // See subscription.service.ts's createSubscriptionCore doc comment.
    const mockProvider = getMockBillingProvider();
    const customer = await mockProvider.createCustomer({ ownerType: "business", ownerId: biz.id as string, email: owner.email!, name: owner.name! });
    const providerSub = await mockProvider.createSubscription({
      providerCustomerId: customer.providerCustomerId,
      planCode: plan.code,
      billingInterval: "monthly",
      trialDays: 14,
    });
    await Subscription.create({
      ownerType: "business",
      ownerId: biz._id,
      planId: plan._id,
      status: "trialing",
      billingInterval: "monthly",
      currentPeriodStart: providerSub.currentPeriodStart,
      currentPeriodEnd: providerSub.currentPeriodEnd,
      trialStart: new Date(),
      trialEnd: providerSub.trialEnd,
      provider: "mock",
      providerCustomerId: customer.providerCustomerId,
      providerSubscriptionId: providerSub.providerSubscriptionId,
    });

    const staffAttempt = await request(app)
      .post(`/api/v1/businesses/${biz.id}/subscription/mock-advance`)
      .set("Authorization", `Bearer ${tokenFor(staff)}`)
      .send({ status: "active" });
    expect(staffAttempt.status).toBe(403);

    const res = await request(app)
      .post(`/api/v1/businesses/${biz.id}/subscription/mock-advance`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "active" });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.status).toBe("active");

    const stored = await Subscription.findOne({ ownerType: "business", ownerId: biz._id });
    expect(stored!.status).toBe("active");
  });
});

describe("concurrency — duplicate subscription creation for the same business", () => {
  it("under true concurrency, only one of two simultaneous create requests succeeds", async () => {
    const [a, b] = await Promise.all([
      request(app)
        .post(`/api/v1/businesses/${raceBusiness.id}/subscription`)
        .set("Authorization", `Bearer ${raceOwnerToken}`)
        .send({ planCode: plan.code, billingInterval: "monthly" }),
      request(app)
        .post(`/api/v1/businesses/${raceBusiness.id}/subscription`)
        .set("Authorization", `Bearer ${raceOwnerToken}`)
        .send({ planCode: plan.code, billingInterval: "monthly" }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const count = await Subscription.countDocuments({ ownerType: "business", ownerId: raceBusiness._id });
    expect(count).toBe(1);
  });
});

describe("GET /platform/subscriptions — platform-admin read-only overview", () => {
  it("platform_admin can list subscriptions across businesses", async () => {
    const res = await request(app).get("/api/v1/platform/subscriptions").set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((s: { businessName?: string }) => s.businessName === business.name)).toBe(true);
  });

  it("an owner (not platform_admin) cannot access the platform-wide list", async () => {
    const res = await request(app).get("/api/v1/platform/subscriptions").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });

  it("platform_admin cannot manage business billing via the business route (no billing.read/manage)", async () => {
    const res = await request(app)
      .get(`/api/v1/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`);
    expect(res.status).toBe(403);
  });
});
