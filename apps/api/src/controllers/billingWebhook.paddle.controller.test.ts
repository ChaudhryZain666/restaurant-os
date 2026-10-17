import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { SIMULATED_EVENT_IGNORED } from "../services/subscription.service.js";
import { closeTestConnections, createTestPlan, createTestSubscription } from "../test-utils/fixtures.js";

/**
 * Phase 89 — POST /api/v1/webhooks/billing/paddle end to end, in-process (supertest, no port, no
 * tunnel, no Paddle): the real route, raw-body capture, Paddle signature check, event mapping and
 * service, with a Paddle provider built from a test-only secret. The suite's environment stays
 * BILLING_PROVIDER=mock (jest.setup.env.ts refuses anything else); only this file swaps the
 * provider module, so nothing here can load real credentials. Any outbound fetch would throw.
 *
 * jest.mock is hoisted above the imports (ts-jest compiles these tests to CommonJS), so the factory
 * can't use this file's constants — the secret is repeated as a literal there.
 */
jest.mock("../billing/index.js", () => {
  const { PaddleBillingProvider } = jest.requireActual<typeof import("../billing/PaddleBillingProvider.js")>("../billing/PaddleBillingProvider.js");
  const paddle = new PaddleBillingProvider("test-only-api-key", "test-only-paddle-webhook-secret", "https://sandbox-api.paddle.com");
  return {
    getBillingProvider: () => paddle,
    getMockBillingProvider: () => {
      throw new Error("The mock billing driver is only available when BILLING_PROVIDER=mock.");
    },
    shouldWarnAboutMockBillingProviderInProduction: () => false,
  };
});
const SECRET = "test-only-paddle-webhook-secret";

const app = createApp();
const ownerIds: mongoose.Types.ObjectId[] = [];
let plan: Awaited<ReturnType<typeof createTestPlan>>;
let seq = 0;

beforeAll(async () => {
  await connectDB();
  plan = await createTestPlan({
    pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: `pri_p89http_${new mongoose.Types.ObjectId().toString()}` }],
  });
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingWebhookEvent.deleteMany({ eventId: /_p89http_/ }),
    Plan.deleteOne({ _id: plan._id }),
  ]);
  await closeTestConnections();
});

async function paddleSubscription() {
  const ownerId = new mongoose.Types.ObjectId();
  ownerIds.push(ownerId);
  const providerSubscriptionId = `sub_p89http_${ownerId.toString()}`;
  await createTestSubscription("business", ownerId, plan._id, {
    provider: "paddle",
    providerSubscriptionId,
    currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
    lastProviderEventAt: new Date("2026-10-15T00:00:00Z"),
  });
  return { ownerId, providerSubscriptionId };
}

function eventId(prefix: "evt" | "ntfsimevt") {
  seq += 1;
  return `${prefix}_p89http_${Date.now()}_${seq}`;
}

/** Signs exactly as Paddle does: HMAC-SHA256 over `${ts}:${rawBody}`, header `ts=…;h1=…`. */
function post(payload: object, secret = SECRET) {
  const rawBody = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  const h1 = createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex");
  return request(app).post("/api/v1/webhooks/billing/paddle").set("Content-Type", "application/json").set("Paddle-Signature", `ts=${ts};h1=${h1}`).send(rawBody);
}

const renewalPayment = (id: string, providerSubscriptionId: string) => ({
  event_id: id,
  event_type: "transaction.completed",
  occurred_at: new Date().toISOString(),
  data: { id: `txn_${id}`, subscription_id: providerSubscriptionId, status: "completed", origin: "subscription_recurring", currency_code: "USD", details: { totals: { total: "5900" } } },
});

const subscriptionUpdate = (id: string, providerSubscriptionId: string, occurredAt: string) => ({
  event_id: id,
  event_type: "subscription.updated",
  occurred_at: occurredAt,
  data: {
    id: providerSubscriptionId,
    status: "active",
    current_billing_period: { starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" },
    items: [{ price: { id: plan.pricing[0].providerPriceId } }],
    scheduled_change: null,
  },
});

const subscriptionState = async (ownerId: mongoose.Types.ObjectId) => {
  const s = (await Subscription.findOne({ ownerId }).lean())!;
  return { status: s.status, planId: String(s.planId), start: s.currentPeriodStart, end: s.currentPeriodEnd, lastProviderEventAt: s.lastProviderEventAt };
};

describe("POST /webhooks/billing/paddle — simulator events over the real route (Phase 89)", () => {
  it("a correctly signed simulated renewal is acknowledged, recorded as ignored, applies nothing, and a repeat stays a no-op", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const before = await subscriptionState(ownerId);
    const payload = renewalPayment(eventId("ntfsimevt"), providerSubscriptionId);

    const first = await post(payload);
    const repeat = await post(payload);

    expect({ status: first.status, body: first.body }).toEqual({ status: 200, body: { received: true } });
    expect(repeat.status).toBe(200);
    const rows = await BillingWebhookEvent.find({ provider: "paddle", eventId: payload.event_id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].processedAt).toBeTruthy();
    expect(rows[0].processingError).toBe(SIMULATED_EVENT_IGNORED);
    expect(await BillingHistoryEvent.countDocuments({ ownerId })).toBe(0);
    expect(await subscriptionState(ownerId)).toEqual(before);
  });

  it("a correctly signed simulated subscription update cannot advance the period or move lastProviderEventAt", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const before = await subscriptionState(ownerId);
    const payload = subscriptionUpdate(eventId("ntfsimevt"), providerSubscriptionId, new Date().toISOString());

    const res = await post(payload);

    expect(res.status).toBe(200);
    expect(await subscriptionState(ownerId)).toEqual(before);
    expect((await BillingWebhookEvent.findOne({ provider: "paddle", eventId: payload.event_id }).lean())?.processingError).toBe(SIMULATED_EVENT_IGNORED);
  });

  it("a simulator event signed with the wrong secret is rejected with 400 and nothing is stored", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const payload = renewalPayment(eventId("ntfsimevt"), providerSubscriptionId);

    const res = await post(payload, "wrong-secret");

    expect(res.status).toBe(400);
    expect(await BillingWebhookEvent.countDocuments({ provider: "paddle", eventId: payload.event_id })).toBe(0);
    expect(await BillingHistoryEvent.countDocuments({ ownerId })).toBe(0);
  });

  it("control: the same renewal as a genuine event records exactly one payment row, and a repeat adds nothing", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const payload = renewalPayment(eventId("evt"), providerSubscriptionId);

    expect((await post(payload)).status).toBe(200);
    expect((await post(payload)).status).toBe(200);

    const history = await BillingHistoryEvent.find({ ownerId }).lean();
    expect(history.map((h) => h.type)).toEqual(["payment_succeeded"]);
    expect(history[0].amountCents).toBe(5900);
    expect((await subscriptionState(ownerId)).status).toBe("active");
    const row = await BillingWebhookEvent.findOne({ provider: "paddle", eventId: payload.event_id }).lean();
    expect(row?.processedAt).toBeTruthy();
    expect(row?.processingError).toBeUndefined();
  });

  it("control: a genuine subscription update still advances the period and lastProviderEventAt", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const occurredAt = "2026-11-01T00:00:05.000Z";

    expect((await post(subscriptionUpdate(eventId("evt"), providerSubscriptionId, occurredAt))).status).toBe(200);

    const after = await subscriptionState(ownerId);
    expect(after.start).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(after.end).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(after.lastProviderEventAt).toEqual(new Date(occurredAt));
    expect(after.status).toBe("active");
  });
});
