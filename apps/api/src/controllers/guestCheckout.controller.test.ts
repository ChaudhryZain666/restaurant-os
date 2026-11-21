import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { getBillingProvider } from "../billing/index.js";
import type { PaddleBillingProvider } from "../billing/PaddleBillingProvider.js";
import { getEmailService } from "../email/index.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Business } from "../models/Business.js";
import { CheckoutIntent } from "../models/CheckoutIntent.js";
import { Plan } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";
import { closeTestConnections, createTestPlan } from "../test-utils/fixtures.js";

/**
 * Launch, 2026-11-21 — the public pay-now checkout end to end over the real routes: start (no
 * account), Paddle's signed subscription.created webhook marks it paid (the browser never does),
 * events before set-up are acknowledged, and the buyer sets up a new account — or attaches the
 * purchase to the account their email already has. Paddle's network calls are stubbed; the
 * webhook signature check is real (same provider swap as billingWebhook.paddle.controller.test.ts).
 */
jest.mock("../billing/index.js", () => {
  const { PaddleBillingProvider } = jest.requireActual<typeof import("../billing/PaddleBillingProvider.js")>("../billing/PaddleBillingProvider.js");
  const paddle = new PaddleBillingProvider("test-only-api-key", "test-only-guest-webhook-secret", "https://sandbox-api.paddle.com", "test_guestclienttoken");
  return {
    getBillingProvider: () => paddle,
    getMockBillingProvider: () => {
      throw new Error("The mock billing driver is only available when BILLING_PROVIDER=mock.");
    },
    shouldWarnAboutMockBillingProviderInProduction: () => false,
  };
});
const SECRET = "test-only-guest-webhook-secret";
const TAG = "gco" + Date.now().toString(36);

const app = createApp();
const paddle = getBillingProvider() as PaddleBillingProvider;
let plan: Awaited<ReturnType<typeof createTestPlan>>;
let monthlyPriceId: string;
let seq = 0;
const sent: Array<{ to: string; subject: string; text?: string }> = [];
const subscriptionStatus: Record<string, "active" | "cancelled"> = {};

beforeAll(async () => {
  await connectDB();
  monthlyPriceId = `pri_${TAG}monthly`;
  plan = await createTestPlan({
    code: `${TAG}_starter`,
    name: "Owner — Starter",
    isPubliclyListed: true,
    pricing: [
      { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: monthlyPriceId },
      { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: "mock_price_not_loaded" },
    ],
  });
  jest.spyOn(getEmailService(), "send").mockImplementation(async (m) => {
    sent.push({ to: m.to, subject: m.subject, text: m.text });
  });
  jest.spyOn(paddle, "retrieveCustomer").mockImplementation(async (id) => ({ providerCustomerId: id, email: `${id}@buyer.test` }));
  jest.spyOn(paddle, "retrieveSubscription").mockImplementation(async (id) => ({
    providerSubscriptionId: id,
    status: subscriptionStatus[id] ?? "active",
    currentPeriodStart: new Date("2026-11-21T00:00:00Z"),
    currentPeriodEnd: new Date("2026-12-21T00:00:00Z"),
  }));
  jest.spyOn(paddle, "setCustomerOwner").mockResolvedValue(undefined);
});

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  const intents = await CheckoutIntent.find({ planCode: plan.code }).lean();
  const users = await User.find({ email: new RegExp(`${TAG}.*@buyer\\.test$`) }).lean();
  const businessIds = users.map((u) => u.businessId).filter(Boolean);
  await Promise.all([
    CheckoutIntent.deleteMany({ planCode: plan.code }),
    Subscription.deleteMany({ ownerId: { $in: businessIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: businessIds } }),
    Restaurant.deleteMany({ businessId: { $in: businessIds } }),
    Business.deleteMany({ _id: { $in: businessIds } }),
    User.deleteMany({ _id: { $in: users.map((u) => u._id) } }),
    BillingWebhookEvent.deleteMany({ eventId: new RegExp(TAG) }),
    Plan.deleteOne({ _id: plan._id }),
  ]);
  expect(intents.length).toBeGreaterThan(0);
  await closeTestConnections();
});

function webhook(payload: object) {
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", SECRET).update(`${ts}:${rawBody}`).digest("hex");
  return request(app).post("/api/v1/webhooks/billing/paddle").set("Content-Type", "application/json").set("Paddle-Signature", `ts=${ts};h1=${h1}`).send(rawBody);
}

function ids() {
  seq += 1;
  return { eventId: `evt_${TAG}_${seq}`, subscriptionId: `sub_${TAG}_${seq}`, customerId: `ctm_${TAG}_${seq}` };
}

const created = (intentId: string, e: ReturnType<typeof ids>, priceId = monthlyPriceId) => ({
  event_id: e.eventId,
  event_type: "subscription.created",
  occurred_at: new Date().toISOString(),
  data: {
    id: e.subscriptionId,
    status: "active",
    customer_id: e.customerId,
    custom_data: { checkoutIntentId: intentId },
    current_billing_period: { starts_at: "2026-11-21T00:00:00Z", ends_at: "2026-12-21T00:00:00Z" },
    items: [{ price: { id: priceId } }],
    scheduled_change: null,
  },
});

async function start() {
  const res = await request(app).post("/api/v1/public/checkout").send({ planCode: plan.code, billingInterval: "monthly" });
  expect(res.status).toBe(201);
  return res.body.data as { token: string; checkout: { clientToken: string; providerPriceId: string; customData: { checkoutIntentId: string } } };
}

async function startAndPay() {
  const started = await start();
  const e = ids();
  const res = await webhook(created(started.checkout.customData.checkoutIntentId, e));
  expect(res.status).toBe(200);
  return { ...started, ...e, email: `${e.customerId}@buyer.test`.toLowerCase() };
}

const restaurant = () => ({ name: "Pay Now Bistro", slug: `${TAG}-${++seq}`, timezone: "America/New_York" });
const status = (token: string) => request(app).post("/api/v1/public/checkout/status").send({ token });

describe("public pay-now checkout (Launch, 2026-11-21)", () => {
  it("starts without an account: an open intent, the Paddle price and client token, nothing paid", async () => {
    const started = await start();
    expect(started.checkout).toMatchObject({ clientToken: "test_guestclienttoken", providerPriceId: monthlyPriceId });
    const intent = (await CheckoutIntent.findById(started.checkout.customData.checkoutIntentId).lean())!;
    expect(intent).toMatchObject({ status: "open", planCode: plan.code, billingInterval: "monthly" });
    expect(intent.expiresAt).toBeInstanceOf(Date);
    expect((await status(started.token)).body.data).toMatchObject({ status: "open", email: null });
  });

  it("refuses an interval whose Paddle price isn't loaded, and a plan that isn't sold", async () => {
    const res = await request(app).post("/api/v1/public/checkout").send({ planCode: plan.code, billingInterval: "yearly" });
    expect(res.status).toBe(503);
    const unknown = await request(app).post("/api/v1/public/checkout").send({ planCode: "no_such_plan", billingInterval: "monthly" });
    expect(unknown.status).toBe(404);
  });

  it("only the verified webhook marks it paid, emails a set-up link, and a redelivery changes nothing", async () => {
    const started = await start();
    const e = ids();
    const payload = created(started.checkout.customData.checkoutIntentId, e);

    // A forged (unsigned) call is refused and leaves the intent open.
    const forged = await request(app).post("/api/v1/webhooks/billing/paddle").set("Content-Type", "application/json").send(JSON.stringify(payload));
    expect(forged.status).toBe(400);
    expect((await status(started.token)).body.data.status).toBe("open");

    expect((await webhook(payload)).status).toBe(200);
    expect((await webhook(payload)).status).toBe(200);
    const s = (await status(started.token)).body.data;
    expect(s).toMatchObject({ status: "paid", email: `${e.customerId}@buyer.test`.toLowerCase(), emailHasAccount: false, billingInterval: "monthly" });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/\/claim#token=/);
    const intent = (await CheckoutIntent.findById(started.checkout.customData.checkoutIntentId).lean())!;
    expect(intent.expiresAt).toBeUndefined();
    expect(intent.providerSubscriptionId).toBe(e.subscriptionId);
  });

  it("a payment for an unknown intent is recorded and not applied (no retry loop)", async () => {
    const e = ids();
    const res = await webhook(created(new mongoose.Types.ObjectId().toString(), e));
    expect(res.status).toBe(200);
    const row = (await BillingWebhookEvent.findOne({ eventId: e.eventId }).lean())!;
    expect(row.processingError).toMatch(/unknown checkout intent/);
  });

  it("events before set-up are acknowledged instead of retried", async () => {
    const paid = await startAndPay();
    const update = {
      event_id: `evt_${TAG}_upd_${++seq}`,
      event_type: "subscription.updated",
      occurred_at: new Date(Date.now() + 1000).toISOString(),
      data: { id: paid.subscriptionId, status: "active", items: [{ price: { id: monthlyPriceId } }], scheduled_change: null },
    };
    expect((await webhook(update)).status).toBe(200);
  });

  it("sets up a NEW account: owner, restaurant and an active Paddle subscription; the link works once", async () => {
    const paid = await startAndPay();
    const res = await request(app)
      .post("/api/v1/public/checkout/claim")
      .send({ token: paid.token, name: "New Owner", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(res.status).toBe(201);
    expect(res.body.data.accessToken).toEqual(expect.any(String));

    const user = (await User.findOne({ email: paid.email }).lean())!;
    expect(user.role).toBe("restaurant_owner");
    expect(user.emailVerifiedAt).toBeUndefined(); // checkout-page link: the inbox isn't proven yet
    const sub = (await Subscription.findOne({ ownerId: user.businessId }).lean())!;
    expect(sub).toMatchObject({ status: "active", provider: "paddle", providerSubscriptionId: paid.subscriptionId, billingInterval: "monthly" });
    expect(String(sub.planId)).toBe(String(plan._id));
    expect(sub.trialEnd).toBeUndefined();
    expect((await CheckoutIntent.findById(paid.checkout.customData.checkoutIntentId).lean())!.status).toBe("claimed");

    const again = await request(app)
      .post("/api/v1/public/checkout/claim")
      .send({ token: paid.token, name: "Again", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(again.status).toBe(409);

    // Once linked, provider events apply to the Subscription as usual.
    const cancel = {
      event_id: `evt_${TAG}_cancel_${++seq}`,
      event_type: "subscription.canceled",
      occurred_at: new Date(Date.now() + 5000).toISOString(),
      data: { id: paid.subscriptionId, status: "canceled", items: [{ price: { id: monthlyPriceId } }], scheduled_change: null },
    };
    expect((await webhook(cancel)).status).toBe(200);
    expect((await Subscription.findOne({ _id: sub._id }).lean())!.status).toBe("cancelled");
  });

  it("the emailed link verifies the address", async () => {
    const started = await start();
    const e = ids();
    await webhook(created(started.checkout.customData.checkoutIntentId, e));
    const emailToken = /#token=([A-Za-z0-9_-]+)/.exec(sent[0].text!)![1];
    const res = await request(app)
      .post("/api/v1/public/checkout/claim")
      .send({ token: emailToken, name: "Inbox Owner", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(res.status).toBe(201);
    expect((await User.findOne({ email: `${e.customerId}@buyer.test`.toLowerCase() }).lean())!.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("can't be set up before the payment is confirmed, or after the purchase was cancelled", async () => {
    const open = await start();
    const early = await request(app).post("/api/v1/public/checkout/claim").send({ token: open.token, name: "x", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(early.status).toBe(409);

    const paid = await startAndPay();
    subscriptionStatus[paid.subscriptionId] = "cancelled";
    const late = await request(app).post("/api/v1/public/checkout/claim").send({ token: paid.token, name: "x", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(late.status).toBe(409);
    expect(await User.exists({ email: paid.email })).toBeNull();
  });

  it("an email that already has an account: refused for a new account, attached after signing in", async () => {
    const paid = await startAndPay();
    // The buyer already has a (customer) account with this email.
    await request(app).post("/api/v1/auth/register").send({ name: "Existing", email: paid.email, password: "ExistingPass1!" }).expect(201);
    expect((await status(paid.token)).body.data.emailHasAccount).toBe(true);

    const refused = await request(app).post("/api/v1/public/checkout/claim").send({ token: paid.token, name: "x", password: "PayNowPass1!", termsAccepted: true, restaurant: restaurant() });
    expect(refused.status).toBe(409);
    expect(refused.body.error.details).toEqual({ reason: "email_has_account" });

    const login = await request(app).post("/api/v1/auth/login").send({ email: paid.email, password: "ExistingPass1!" });
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const needsRestaurant = await request(app).post("/api/v1/public/checkout/claim/signed-in").set(auth).send({ token: paid.token });
    expect(needsRestaurant.status).toBe(400);
    const attached = await request(app).post("/api/v1/public/checkout/claim/signed-in").set(auth).send({ token: paid.token, termsAccepted: true, restaurant: restaurant() });
    expect(attached.status).toBe(200);
    const user = (await User.findOne({ email: paid.email }).lean())!;
    expect(user.role).toBe("restaurant_owner");
    expect((await Subscription.findOne({ ownerId: user.businessId }).lean())!).toMatchObject({ status: "active", providerSubscriptionId: paid.subscriptionId });
  });
});
