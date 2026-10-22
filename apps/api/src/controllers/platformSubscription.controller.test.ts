import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { AuditLog } from "../models/AuditLog.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import {
  closeTestConnections,
  createTestAgency,
  createTestBusiness,
  createTestPlan,
  createTestRestaurant,
  createTestSubscription,
  createTestUser,
  tokenFor,
} from "../test-utils/fixtures.js";

const app = createApp();

let platformAdminToken: string;
let ownerToken: string;
const userIds: string[] = [];
const businessIds: mongoose.Types.ObjectId[] = [];
const agencyIds: mongoose.Types.ObjectId[] = [];
const planIds: mongoose.Types.ObjectId[] = [];
const restaurantIds: mongoose.Types.ObjectId[] = [];

async function plan(overrides: Partial<Record<string, unknown>> = {}) {
  const p = await createTestPlan({ trialDays: 14, ...overrides });
  planIds.push(p._id);
  return p;
}

async function businessWithLocation() {
  const business = await createTestBusiness();
  businessIds.push(business._id);
  const restaurant = await createTestRestaurant({ businessId: business._id });
  restaurantIds.push(restaurant._id);
  return { business, restaurant };
}

beforeAll(async () => {
  await connectDB();
  const platformAdmin = await createTestUser("platform_admin");
  const owner = await createTestUser("restaurant_owner");
  userIds.push(platformAdmin.id, owner.id);
  platformAdminToken = tokenFor(platformAdmin);
  ownerToken = tokenFor(owner);
});

afterAll(async () => {
  const ownerIds = [...businessIds, ...agencyIds];
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: ownerIds } }),
    AuditLog.deleteMany({ restaurantId: { $in: restaurantIds } }),
    AgencyAuditLog.deleteMany({ agencyId: { $in: agencyIds } }),
    Restaurant.deleteMany({ _id: { $in: restaurantIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    Agency.deleteMany({ _id: { $in: agencyIds } }),
    Plan.deleteMany({ _id: { $in: planIds } }),
    User.deleteMany({ _id: { $in: userIds } }),
  ]);
  await closeTestConnections();
}, 20_000);

describe("GET /platform/plans (Lane A)", () => {
  it("lists active plans including private ones, never exposing provider price ids", async () => {
    const privatePlan = await plan({
      name: "Client custom",
      isPubliclyListed: false,
      pricing: [{ interval: "monthly", amountCents: 4500, currency: "USD", providerPriceId: "pri_secretish" }],
    });
    const inactive = await plan({ isActive: false });

    const res = await request(app).get("/api/v1/platform/plans").set("Authorization", `Bearer ${platformAdminToken}`);

    expect(res.status).toBe(200);
    const items = res.body.data.items as { code: string }[];
    const found = items.find((i) => i.code === privatePlan.code);
    expect(found).toMatchObject({
      isPubliclyListed: false,
      assignable: true,
      trialDays: 14,
      pricing: [{ interval: "monthly", amountCents: 4500, currency: "USD", hasCheckoutPrice: true }],
    });
    expect(items.some((i) => i.code === inactive.code)).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("pri_secretish");
  });

  it("marks a no-trial plan as not assignable", async () => {
    const noTrial = await plan({ trialDays: 0 });
    const res = await request(app).get("/api/v1/platform/plans").set("Authorization", `Bearer ${platformAdminToken}`);
    const found = (res.body.data.items as { code: string; assignable: boolean }[]).find((i) => i.code === noTrial.code);
    expect(found?.assignable).toBe(false);
  });

  it("is platform_admin only", async () => {
    const res = await request(app).get("/api/v1/platform/plans").set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(403);
  });
});

describe("POST /platform/businesses/:businessId/subscription (Lane A)", () => {
  it("starts a trial on a private plan through the lifecycle service, with history and audit rows", async () => {
    const { business, restaurant } = await businessWithLocation();
    const privatePlan = await plan({ isPubliclyListed: false });

    const res = await request(app)
      .post(`/api/v1/platform/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: privatePlan.code, billingInterval: "monthly" });

    expect(res.status).toBe(201);
    expect(res.body.data.subscription).toMatchObject({ status: "trialing", billingInterval: "monthly" });

    const sub = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    expect(sub?.planId.toString()).toBe(privatePlan.id);
    expect(sub?.providerSubscriptionId).toBeFalsy();
    expect(await BillingHistoryEvent.countDocuments({ ownerId: business._id, type: "trial_started" })).toBe(1);
    const audit = await AuditLog.findOne({ restaurantId: restaurant._id, action: "subscription.created" });
    expect(audit?.metadata).toMatchObject({ planCode: privatePlan.code, assignedBy: "platform_admin" });
  });

  it("refuses a second live subscription and leaves the existing one untouched", async () => {
    const { business } = await businessWithLocation();
    const current = await plan();
    const other = await plan();
    const existing = await createTestSubscription("business", business._id, current._id);

    const res = await request(app)
      .post(`/api/v1/platform/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: other.code, billingInterval: "monthly" });

    expect(res.status).toBe(409);
    const after = await Subscription.findById(existing._id);
    expect(after?.planId.toString()).toBe(current.id);
    expect(await Subscription.countDocuments({ ownerId: business._id })).toBe(1);
  });

  it("refuses a no-trial plan (needs checkout), an agency plan, and an inactive plan", async () => {
    const { business } = await businessWithLocation();
    const noTrial = await plan({ trialDays: 0 });
    const agencyPlan = await plan({ type: "AGENCY" });
    const inactive = await plan({ isActive: false });

    for (const code of [noTrial.code, agencyPlan.code, inactive.code]) {
      const res = await request(app)
        .post(`/api/v1/platform/businesses/${business.id}/subscription`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ planCode: code, billingInterval: "monthly" });
      expect(res.status).toBe(400);
    }
    expect(await Subscription.countDocuments({ ownerId: business._id })).toBe(0);
  });

  it("404s an unknown business and 403s a non-platform-admin", async () => {
    const p = await plan();
    const missing = await request(app)
      .post(`/api/v1/platform/businesses/${new mongoose.Types.ObjectId().toString()}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: p.code, billingInterval: "monthly" });
    expect(missing.status).toBe(404);

    const { business } = await businessWithLocation();
    const forbidden = await request(app)
      .post(`/api/v1/platform/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ planCode: p.code, billingInterval: "monthly" });
    expect(forbidden.status).toBe(403);
    expect(await Subscription.countDocuments({ ownerId: business._id })).toBe(0);
  });
});

describe("POST /platform/agencies/:agencyId/subscription (Lane A)", () => {
  it("starts an agency trial on an AGENCY plan and records an agency audit event", async () => {
    const agency = await createTestAgency();
    agencyIds.push(agency._id);
    const agencyPlan = await plan({ type: "AGENCY", isPubliclyListed: false });

    const res = await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: agencyPlan.code, billingInterval: "yearly" });

    expect(res.status).toBe(201);
    expect(res.body.data.subscription).toMatchObject({ status: "trialing", billingInterval: "yearly" });
    const audit = await AgencyAuditLog.findOne({ agencyId: agency._id, action: "agency.subscription_created" });
    expect(audit?.metadata).toMatchObject({ planCode: agencyPlan.code, assignedBy: "platform_admin" });
  });

  it("refuses an OWNER plan for an agency", async () => {
    const agency = await createTestAgency();
    agencyIds.push(agency._id);
    const ownerPlan = await plan();
    const res = await request(app)
      .post(`/api/v1/platform/agencies/${agency.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: ownerPlan.code, billingInterval: "monthly" });
    expect(res.status).toBe(400);
  });
});

describe("private plans stay platform-assigned (Lane A)", () => {
  async function ownerOf(business: { _id: mongoose.Types.ObjectId }, restaurantId: mongoose.Types.ObjectId) {
    const owner = await createTestUser("restaurant_owner", restaurantId, { businessId: business._id });
    userIds.push(owner.id);
    await Business.updateOne({ _id: business._id }, { ownerId: owner._id });
    return tokenFor(owner);
  }

  it("GET /plans hides private plans from owners but not from platform admins", async () => {
    const privatePlan = await plan({ isPubliclyListed: false });
    const publicPlan = await plan();
    const { business, restaurant } = await businessWithLocation();
    const token = await ownerOf(business, restaurant._id);

    const asOwner = await request(app).get("/api/v1/plans").set("Authorization", `Bearer ${token}`);
    const ownerCodes = (asOwner.body.data.plans as { code: string }[]).map((p) => p.code);
    expect(ownerCodes).toContain(publicPlan.code);
    expect(ownerCodes).not.toContain(privatePlan.code);

    const asAdmin = await request(app).get("/api/v1/plans").set("Authorization", `Bearer ${platformAdminToken}`);
    expect((asAdmin.body.data.plans as { code: string }[]).map((p) => p.code)).toContain(privatePlan.code);
  });

  it("an owner can't start a trial, check out, or switch onto a private plan by its code", async () => {
    const privatePlan = await plan({
      isPubliclyListed: false,
      pricing: [{ interval: "monthly", amountCents: 100, currency: "USD", providerPriceId: "pri_private_test" }],
    });
    const publicPlan = await plan();
    const { business, restaurant } = await businessWithLocation();
    const token = await ownerOf(business, restaurant._id);
    const base = `/api/v1/businesses/${business.id}/subscription`;

    const trial = await request(app).post(base).set("Authorization", `Bearer ${token}`).send({ planCode: privatePlan.code, billingInterval: "monthly" });
    expect(trial.status).toBe(400);
    const checkout = await request(app)
      .post(`${base}/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: privatePlan.code, billingInterval: "monthly" });
    expect(checkout.status).toBe(400);
    expect(await Subscription.countDocuments({ ownerId: business._id })).toBe(0);

    const ownTrial = await request(app).post(base).set("Authorization", `Bearer ${token}`).send({ planCode: publicPlan.code, billingInterval: "monthly" });
    expect(ownTrial.status).toBe(201);
    const change = await request(app).post(`${base}/change-plan`).set("Authorization", `Bearer ${token}`).send({ planCode: privatePlan.code });
    expect(change.status).toBe(400);
    const sub = await Subscription.findOne({ ownerId: business._id });
    expect(sub!.planId.toString()).toBe(publicPlan.id);
  });

  it("an owner CAN check out the private plan a platform admin assigned them", async () => {
    const privatePlan = await plan({
      isPubliclyListed: false,
      pricing: [{ interval: "monthly", amountCents: 100, currency: "USD", providerPriceId: "pri_private_assigned" }],
    });
    const { business, restaurant } = await businessWithLocation();
    const token = await ownerOf(business, restaurant._id);

    const assigned = await request(app)
      .post(`/api/v1/platform/businesses/${business.id}/subscription`)
      .set("Authorization", `Bearer ${platformAdminToken}`)
      .send({ planCode: privatePlan.code, billingInterval: "monthly" });
    expect(assigned.status).toBe(201);

    const checkout = await request(app)
      .post(`/api/v1/businesses/${business.id}/subscription/checkout`)
      .set("Authorization", `Bearer ${token}`)
      .send({ planCode: privatePlan.code, billingInterval: "monthly" });
    expect(checkout.status).toBe(200);
  });

  it("change-plan refuses a plan of the wrong type", async () => {
    const ownerPlan = await plan();
    const agencyPlan = await plan({ type: "AGENCY" });
    const { business, restaurant } = await businessWithLocation();
    const token = await ownerOf(business, restaurant._id);
    const base = `/api/v1/businesses/${business.id}/subscription`;
    await request(app).post(base).set("Authorization", `Bearer ${token}`).send({ planCode: ownerPlan.code, billingInterval: "monthly" });

    const change = await request(app).post(`${base}/change-plan`).set("Authorization", `Bearer ${token}`).send({ planCode: agencyPlan.code });
    expect(change.status).toBe(400);
  });
});
