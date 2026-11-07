import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { getBillingProvider } from "../billing/index.js";
import { AgencyAuditLog } from "../models/AgencyAuditLog.js";
import { AuditLog } from "../models/AuditLog.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { expireLapsedManualSubscriptions, processBillingProviderEvent } from "../services/subscription.service.js";
import { resolveSubscriptionState } from "../services/subscriptionResolution.service.js";
import { logger } from "../common/logger.js";
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

/**
 * Platform-admin manual subscriptions (provider "manual") end to end over the real routes: who may
 * call them, what each action stores, that no billing provider is ever called and no payment ever
 * recorded, that the owner can't change or replace one, and that access ends with it.
 */

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

let adminToken: string;
let agencyOwnerToken: string;
const userIds: string[] = [];
const businessIds: mongoose.Types.ObjectId[] = [];
const agencyIds: mongoose.Types.ObjectId[] = [];
const planIds: mongoose.Types.ObjectId[] = [];
const restaurantIds: mongoose.Types.ObjectId[] = [];
let starter: Awaited<ReturnType<typeof createTestPlan>>;
let growth: Awaited<ReturnType<typeof createTestPlan>>;
let agencyPlan: Awaited<ReturnType<typeof createTestPlan>>;

async function plan(overrides: Partial<Record<string, unknown>> = {}) {
  const p = await createTestPlan({ trialDays: 14, ...overrides });
  planIds.push(p._id);
  return p;
}

/** A business with one location and its owner (who holds billing.manage on it). */
async function ownedBusiness() {
  const business = await createTestBusiness();
  businessIds.push(business._id);
  const restaurant = await createTestRestaurant({ businessId: business._id });
  restaurantIds.push(restaurant._id);
  const owner = await createTestUser("restaurant_owner", restaurant._id, { businessId: business._id });
  userIds.push(owner.id);
  return { business, restaurant, ownerToken: tokenFor(owner) };
}

const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);

function createManual(businessId: string, body: Record<string, unknown>) {
  return asAdmin(request(app).post(`/api/v1/platform/businesses/${businessId}/subscription/manual`)).send(body);
}

beforeAll(async () => {
  await connectDB();
  const admin = await createTestUser("platform_admin");
  userIds.push(admin.id);
  adminToken = tokenFor(admin);

  const agency = await createTestAgency();
  agencyIds.push(agency._id);
  const agencyOwner = await createTestUser("agency_member");
  userIds.push(agencyOwner.id);
  agencyOwnerToken = tokenFor(agencyOwner, [{ agencyId: agency.id as string, role: "agency_owner" }]);

  // XTS is ISO 4217's reserved testing code — keeps this file's revenue figures apart from any
  // other fixture's in the shared test database.
  starter = await plan({
    name: "Owner Starter (test)",
    pricing: [
      { interval: "monthly", amountCents: 5900, currency: "XTS" },
      { interval: "yearly", amountCents: 59000, currency: "XTS" },
    ],
  });
  growth = await plan({
    name: "Owner Growth (test)",
    pricing: [
      { interval: "monthly", amountCents: 9900, currency: "XTS" },
      { interval: "yearly", amountCents: 99000, currency: "XTS" },
    ],
  });
  agencyPlan = await plan({ name: "Agency Growth (test)", type: "AGENCY", pricing: [{ interval: "monthly", amountCents: 17900, currency: "XTS" }] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const ownerIds = [...businessIds, ...agencyIds];
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingWebhookEvent.deleteMany({ eventId: /^manualtest_/ }),
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

describe("who may manage subscriptions", () => {
  it("refuses owners, agency members and anonymous callers on every platform subscription route", async () => {
    const { business, ownerToken } = await ownedBusiness();
    const sub = await createTestSubscription("business", business._id, starter._id, { provider: "manual", manualBilling: { kind: "complimentary", amountCents: 0, currency: "XTS" } });
    const routes: Array<[string, string, Record<string, unknown>]> = [
      ["post", `/api/v1/platform/businesses/${business.id}/subscription/manual`, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) }],
      ["post", `/api/v1/platform/subscriptions/${sub.id}/extend`, { endsAt: inDays(400) }],
      ["post", `/api/v1/platform/subscriptions/${sub.id}/suspend`, { reason: "x" }],
      ["post", `/api/v1/platform/subscriptions/${sub.id}/cancel`, { when: "immediately" }],
      ["get", `/api/v1/platform/businesses/${business.id}/billing-history`, {}],
    ];
    for (const [method, url, body] of routes) {
      const anon = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).send(body);
      const owner = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set("Authorization", `Bearer ${ownerToken}`).send(body);
      const agency = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method](url).set("Authorization", `Bearer ${agencyOwnerToken}`).send(body);
      expect({ url, anon: anon.status, owner: owner.status, agency: agency.status }).toEqual({ url, anon: 401, owner: 403, agency: 403 });
    }
    expect((await Subscription.findById(sub._id))!.status).toBe("active");
  });
});

describe("creating a manual subscription", () => {
  it("creates a complimentary subscription with no billing provider, no payment, and an audit entry", async () => {
    const { business, restaurant } = await ownedBusiness();
    const provider = getBillingProvider();
    const providerCalls = (["createCustomer", "createCheckoutSession", "createSubscription", "changePlan", "cancelSubscription"] as const).map((m) =>
      jest.spyOn(provider, m)
    );

    const res = await createManual(business.id, { planCode: starter.code, billingInterval: "yearly", kind: "complimentary", endsAt: inDays(365), note: "Launch partner" });

    expect(res.status).toBe(201);
    expect(res.body.data.subscription).toMatchObject({
      status: "active",
      isLive: true,
      billingSource: "complimentary",
      provider: "manual",
      planCode: starter.code,
      billingInterval: "yearly",
      manualBilling: { kind: "complimentary", amountCents: 0, currency: "XTS", note: "Launch partner" },
      suspendedAt: null,
    });
    for (const spy of providerCalls) expect(spy).not.toHaveBeenCalled();

    const stored = (await Subscription.findOne({ ownerId: business._id }))!;
    expect(stored.providerSubscriptionId).toBeUndefined();
    expect(stored.providerCustomerId).toBeUndefined();

    const history = await BillingHistoryEvent.find({ ownerId: business._id }).lean();
    expect(history.map((h) => h.type)).toEqual(["subscription_created"]);
    expect(history[0].amountCents).toBeUndefined(); // an agreement, never a payment
    expect(history[0].provider).toBe("manual");
    expect(await BillingHistoryEvent.countDocuments({ ownerId: business._id, type: "payment_succeeded" })).toBe(0);

    const audit = await AuditLog.findOne({ restaurantId: restaurant._id, action: "subscription.created" }).lean();
    expect(audit?.metadata).toMatchObject({ kind: "complimentary", planCode: starter.code, assignedBy: "platform_admin", provider: "manual" });
    expect(JSON.stringify(audit?.metadata)).not.toContain("Launch partner"); // admin notes stay admin-side

    const state = await resolveSubscriptionState("business", business.id);
    expect(state.kind).toBe("live");
  });

  it("prices an offline subscription at the plan price by default, or at a negotiated price", async () => {
    const a = await ownedBusiness();
    const b = await ownedBusiness();
    const listPrice = await createManual(a.business.id, { planCode: growth.code, billingInterval: "monthly", kind: "offline", endsAt: inDays(31) });
    const negotiated = await createManual(b.business.id, { planCode: growth.code, billingInterval: "yearly", kind: "offline", amountCents: 80000, endsAt: inDays(365) });
    expect(listPrice.body.data.subscription).toMatchObject({ billingSource: "manual_offline", manualBilling: { kind: "offline", amountCents: 9900 } });
    expect(negotiated.body.data.subscription).toMatchObject({ billingSource: "manual_offline", manualBilling: { kind: "offline", amountCents: 80000 } });
  });

  it("validates the request: a priced complimentary plan, the wrong plan audience, a future start, a past or far end", async () => {
    const { business } = await ownedBusiness();
    const base = { planCode: starter.code, billingInterval: "monthly", kind: "offline", endsAt: inDays(30) };
    const cases: Array<[Record<string, unknown>, number, RegExp]> = [
      [{ ...base, kind: "complimentary", amountCents: 500 }, 400, /complimentary subscription has no price/i],
      [{ ...base, amountCents: 0 }, 400, /needs a price above zero/],
      [{ ...base, planCode: agencyPlan.code }, 400, /not available for business accounts/],
      [{ ...base, startsAt: inDays(3) }, 400, /can't start in the future/],
      [{ ...base, endsAt: inDays(-1) }, 400, /must be in the future/],
      [{ ...base, endsAt: inDays(6 * 366) }, 400, /at most five years/],
      [{ ...base, planCode: "no-such-plan" }, 400, /Unknown or inactive plan/],
      [{ ...base, endsAt: "next tuesday" }, 400, /./],
    ];
    for (const [body, status, message] of cases) {
      const res = await createManual(business.id, body);
      expect({ body, status: res.status }).toEqual({ body, status });
      expect(JSON.stringify(res.body)).toMatch(message);
    }
    expect(await Subscription.countDocuments({ ownerId: business._id })).toBe(0);
    expect((await createManual(new mongoose.Types.ObjectId().toString(), base)).status).toBe(404);
  });

  it("refuses a second subscription, converts a no-card trial in place, and never replaces a provider-paid one", async () => {
    const withManual = await ownedBusiness();
    const body = { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) };
    expect((await createManual(withManual.business.id, body)).status).toBe(201);
    const again = await createManual(withManual.business.id, body);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toMatch(/already has a complimentary subscription/);

    const onTrial = await ownedBusiness();
    const trial = await createTestSubscription("business", onTrial.business._id, starter._id, { status: "trialing", trialEnd: new Date(Date.now() + 5 * DAY) });
    const converted = await createManual(onTrial.business.id, { ...body, planCode: growth.code });
    expect(converted.status).toBe(201);
    expect(converted.body.data.subscription.id).toBe(trial.id);
    const after = (await Subscription.findById(trial._id))!;
    expect({ provider: after.provider, status: after.status, trialEnd: after.trialEnd, plan: String(after.planId) }).toEqual({
      provider: "manual",
      status: "active",
      trialEnd: undefined,
      plan: String(growth._id),
    });
    expect(await Subscription.countDocuments({ ownerId: onTrial.business._id })).toBe(1);

    const paid = await ownedBusiness();
    await createTestSubscription("business", paid.business._id, starter._id, { provider: "lemonsqueezy", providerSubscriptionId: `ls_${paid.business.id}` });
    const refused = await createManual(paid.business.id, body);
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/already has a Lemon Squeezy subscription/);
  });

  it("still works for a business with no locations yet, logging that there was no audit log to write to", async () => {
    const business = await createTestBusiness();
    businessIds.push(business._id);
    const warn = jest.spyOn(logger, "warn");
    const res = await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) });
    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("no locations"),
      expect.objectContaining({ action: "subscription.created", businessId: business.id })
    );
  });

  it("works for an agency too, audited on the agency's own log", async () => {
    const agency = await createTestAgency();
    agencyIds.push(agency._id);
    const res = await asAdmin(request(app).post(`/api/v1/platform/agencies/${agency.id}/subscription/manual`)).send({
      planCode: agencyPlan.code,
      billingInterval: "monthly",
      kind: "offline",
      endsAt: inDays(31),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.subscription).toMatchObject({ billingSource: "manual_offline", manualBilling: { amountCents: 17900 } });
    expect(await AgencyAuditLog.countDocuments({ agencyId: agency._id, action: "agency.subscription_created" })).toBe(1);
    const wrongAudience = await asAdmin(request(app).post(`/api/v1/platform/agencies/${agency.id}/subscription/manual`)).send({
      planCode: starter.code,
      billingInterval: "monthly",
      kind: "offline",
      endsAt: inDays(31),
    });
    expect(wrongAudience.status).toBe(400);
  });
});

describe("managing a manual subscription", () => {
  async function manualFor(kind: "complimentary" | "offline" = "complimentary") {
    const ctx = await ownedBusiness();
    const res = await createManual(ctx.business.id, { planCode: starter.code, billingInterval: "monthly", kind, endsAt: inDays(30) });
    return { ...ctx, id: res.body.data.subscription.id as string };
  }
  const action = (id: string, name: string, body: Record<string, unknown> = {}) =>
    asAdmin(request(app).post(`/api/v1/platform/subscriptions/${id}/${name}`)).send(body);

  it("extends the end date forward only", async () => {
    const { business, restaurant, id } = await manualFor();
    const later = inDays(120);
    const res = await action(id, "extend", { endsAt: later, note: "Renewed by phone" });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription.currentPeriodEnd).toBe(new Date(later).toISOString());
    expect(res.body.data.subscription.manualBilling.note).toBe("Renewed by phone");
    expect((await action(id, "extend", { endsAt: inDays(60) })).status).toBe(400); // before the current end
    const history = await BillingHistoryEvent.findOne({ ownerId: business._id, type: "subscription_extended" }).lean();
    expect(history?.metadata).toMatchObject({ to: new Date(later) });
    expect(JSON.stringify(history?.metadata)).not.toContain("Renewed by phone");
    expect(await AuditLog.countDocuments({ restaurantId: restaurant._id, action: "subscription.extended" })).toBe(1);
  });

  it("changes plan and interval, repricing an offline agreement", async () => {
    const { business, id } = await manualFor("offline");
    const res = await action(id, "change-plan", { planCode: growth.code, billingInterval: "yearly" });
    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({ planCode: growth.code, billingInterval: "yearly", manualBilling: { amountCents: 99000 } });
    const custom = await action(id, "change-plan", { planCode: growth.code, billingInterval: "monthly", amountCents: 7500 });
    expect(custom.body.data.subscription.manualBilling.amountCents).toBe(7500);
    expect((await action(id, "change-plan", { planCode: growth.code, billingInterval: "monthly", amountCents: 0 })).status).toBe(400);
    const changes = await BillingHistoryEvent.find({ ownerId: business._id, type: "plan_changed" }).lean();
    expect(changes).toHaveLength(2);
    expect(changes.every((c) => c.amountCents === undefined)).toBe(true);
  });

  it("suspends (ending access at once) and unsuspends", async () => {
    const { business, ownerToken, id } = await manualFor();
    const suspended = await action(id, "suspend", { reason: "Unpaid invoice INV-12" });
    expect(suspended.body.data.subscription).toMatchObject({ isLive: false, suspendedReason: "Unpaid invoice INV-12", status: "active" });
    expect((await resolveSubscriptionState("business", business.id)).kind).toBe("lapsed");
    expect((await action(id, "suspend", { reason: "again" })).status).toBe(409);
    // The owner sees a subscription that grants nothing, and still can't touch it.
    const ownerView = await request(app).get(`/api/v1/businesses/${business.id}/subscription`).set("Authorization", `Bearer ${ownerToken}`);
    expect(ownerView.status).toBe(200);

    const restored = await action(id, "unsuspend");
    expect(restored.body.data.subscription).toMatchObject({ isLive: true, suspendedAt: null });
    expect((await resolveSubscriptionState("business", business.id)).kind).toBe("live");
    const types = (await BillingHistoryEvent.find({ ownerId: business._id }).sort({ _id: 1 }).lean()).map((h) => h.type);
    expect(types).toEqual(["subscription_created", "suspended", "reactivated"]);
  });

  it("cancels at the end of the term or immediately, and resumes a scheduled cancellation", async () => {
    const scheduled = await manualFor();
    const atEnd = await action(scheduled.id, "cancel", { when: "period_end" });
    expect(atEnd.body.data.subscription).toMatchObject({ status: "cancelling", isLive: true });
    expect((await action(scheduled.id, "extend", { endsAt: inDays(90) })).status).toBe(409); // resume first
    const resumed = await action(scheduled.id, "resume");
    expect(resumed.body.data.subscription).toMatchObject({ status: "active", cancelAt: null });

    const now = await manualFor();
    const immediate = await action(now.id, "cancel", { when: "immediately" });
    expect(immediate.body.data.subscription).toMatchObject({ status: "cancelled", isLive: false });
    expect((await resolveSubscriptionState("business", now.business.id)).kind).toBe("lapsed");
    expect((await action(now.id, "cancel", { when: "immediately" })).status).toBe(409);
    // Ended — a new agreement can be created.
    expect((await createManual(now.business.id, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) })).status).toBe(201);
  });

  it("only edits manual subscriptions — a trial or provider-paid one is refused with its billing source", async () => {
    const { business } = await ownedBusiness();
    const paid = await createTestSubscription("business", business._id, starter._id, { provider: "lemonsqueezy", providerSubscriptionId: `ls_${business.id}` });
    const provider = getBillingProvider();
    const cancelAtProvider = jest.spyOn(provider, "cancelSubscription");
    for (const [name, body] of [
      ["extend", { endsAt: inDays(90) }],
      ["change-plan", { planCode: growth.code, billingInterval: "monthly" }],
      ["suspend", { reason: "x" }],
    ] as const) {
      const res = await action(paid.id, name, body);
      expect({ name, status: res.status }).toEqual({ name, status: 409 });
      expect(res.body.error.message).toMatch(/this is a Lemon Squeezy subscription/);
    }
    // Cancelling a provider-paid plan goes to the provider and keeps the paid period; never "immediately".
    expect((await action(paid.id, "cancel", { when: "immediately" })).status).toBe(400);
    expect(cancelAtProvider).not.toHaveBeenCalled();
  });
});

describe("the owner can't change or replace a manual subscription", () => {
  it("refuses checkout, plan change, cancel, reactivate and card update, without calling the billing provider", async () => {
    const { business, ownerToken } = await ownedBusiness();
    await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30), note: "internal note" });
    const provider = getBillingProvider();
    const spies = (["createCheckoutSession", "changePlan", "cancelSubscription", "reactivateSubscription", "getPaymentMethodUpdateUrl"] as const).map((m) =>
      jest.spyOn(provider, m)
    );
    const asOwner = (method: "post", path: string, body: Record<string, unknown> = {}) =>
      request(app)[method](`/api/v1/businesses/${business.id}/subscription${path}`).set("Authorization", `Bearer ${ownerToken}`).send(body);

    for (const [path, body] of [
      ["/checkout", { planCode: starter.code, billingInterval: "monthly" }],
      ["/change-plan", { planCode: growth.code }],
      ["/cancel", {}],
      ["/reactivate", {}],
      ["/payment-method-update", {}],
    ] as const) {
      const res = await asOwner("post", path, body);
      expect({ path, status: res.status, message: res.body.error?.message }).toEqual({
        path,
        status: 409,
        message: "Your plan is managed by GarnishTable. Contact support to change it.",
      });
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect((await Subscription.findOne({ ownerId: business._id }))!.provider).toBe("manual");

    const view = await request(app).get(`/api/v1/businesses/${business.id}/subscription`).set("Authorization", `Bearer ${ownerToken}`);
    expect(view.body.data.subscription.manualBilling).toEqual({ kind: "complimentary", amountCents: 0, currency: "XTS" });
    expect(JSON.stringify(view.body)).not.toContain("internal note");
  });

  it("a completed checkout for an owner with a manual subscription is reported as a duplicate purchase, never converting it", async () => {
    const { business } = await ownedBusiness();
    await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) });
    jest.spyOn(getBillingProvider(), "retrieveSubscription").mockResolvedValue({
      providerSubscriptionId: `sub_manualtest_${business.id}`,
      status: "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    });

    await processBillingProviderEvent("mock", {
      eventId: `manualtest_${business.id}`,
      eventType: "subscription.created",
      providerSubscriptionId: `sub_manualtest_${business.id}`,
      raw: {},
      checkoutMetadata: { ownerType: "business", ownerId: business.id, planCode: growth.code, billingInterval: "monthly", providerCustomerId: "cus_x" },
    });

    const subs = await Subscription.find({ ownerId: business._id }).lean();
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({ provider: "manual", planId: starter._id });
    expect((await BillingWebhookEvent.findOne({ eventId: `manualtest_${business.id}` }).lean())?.processingError).toMatch(/^Duplicate purchase/);
  });
});

describe("a manual subscription ends on its end date", () => {
  it("stops granting access the moment it lapses, then is persisted as expired, freeing the slot", async () => {
    const { business } = await ownedBusiness();
    const res = await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) });
    await Subscription.updateOne({ _id: res.body.data.subscription.id }, { $set: { currentPeriodEnd: new Date(Date.now() - 1000) } });

    expect((await resolveSubscriptionState("business", business.id)).kind).toBe("lapsed");
    const detail = await asAdmin(request(app).get(`/api/v1/platform/subscriptions/${res.body.data.subscription.id}`));
    expect(detail.body.data.subscription).toMatchObject({ status: "active", isLive: false });

    await expireLapsedManualSubscriptions({ ownerType: "business", ownerId: business.id });
    expect((await Subscription.findById(res.body.data.subscription.id))!.status).toBe("expired");
    expect(await BillingHistoryEvent.countDocuments({ ownerId: business._id, type: "expired" })).toBe(1);
    expect((await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "offline", endsAt: inDays(30) })).status).toBe(201);
  });
});

describe("platform reporting", () => {
  it("billing history shows the owner's rows and the current subscription's source", async () => {
    const { business } = await ownedBusiness();
    await createManual(business.id, { planCode: starter.code, billingInterval: "monthly", kind: "offline", amountCents: 4900, endsAt: inDays(30) });
    const res = await asAdmin(request(app).get(`/api/v1/platform/businesses/${business.id}/billing-history`));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i: { type: string }) => i.type)).toEqual(["subscription_created"]);
    expect(res.body.data.subscription).toMatchObject({ billingSource: "manual_offline", manualBilling: { amountCents: 4900 } });
    expect((await asAdmin(request(app).get(`/api/v1/platform/businesses/${new mongoose.Types.ObjectId()}/billing-history`))).status).toBe(404);
  });

  it("revenue counts an offline agreement at its agreed price and a complimentary one at nothing", async () => {
    const revenue = async () => (await asAdmin(request(app).get("/api/v1/platform/revenue"))).body.data;
    const xts = (list: Array<{ currency: string; amount: number }>) => list.find((r) => r.currency === "XTS")?.amount ?? 0;
    const before = await revenue();

    const paid = await ownedBusiness();
    await createManual(paid.business.id, { planCode: growth.code, billingInterval: "yearly", kind: "offline", amountCents: 60000, endsAt: inDays(365) });
    const free = await ownedBusiness();
    await createManual(free.business.id, { planCode: growth.code, billingInterval: "monthly", kind: "complimentary", endsAt: inDays(30) });
    const after = await revenue();

    expect(xts(after.mrrByCurrency) - xts(before.mrrByCurrency)).toBeCloseTo(50, 5); // 600.00 a year = 50.00 a month
    expect(xts(after.offlineMrrByCurrency) - xts(before.offlineMrrByCurrency)).toBeCloseTo(50, 5);
    expect(after.complimentaryCount - before.complimentaryCount).toBe(1);
  });

  it("the subscriptions list carries each subscription's billing source", async () => {
    const res = await asAdmin(request(app).get("/api/v1/platform/subscriptions?limit=100"));
    expect(res.status).toBe(200);
    const sources = new Set(res.body.data.items.map((i: { billingSource: string }) => i.billingSource));
    expect(sources.has("complimentary")).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/providerSubscriptionId|providerCustomerId/);
  });
});
