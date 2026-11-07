import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { getBillingProvider } from "../billing/index.js";
import type { LemonSqueezyBillingProvider } from "../billing/LemonSqueezyBillingProvider.js";
import { logger } from "../common/logger.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { BILLING_ALERT_DUPLICATE_PURCHASE, BILLING_ALERT_REJECTED_EVENT } from "../services/subscription.service.js";
import { closeTestConnections, createTestPlan, createTestSubscription } from "../test-utils/fixtures.js";

/**
 * POST /api/v1/webhooks/billing/lemonsqueezy end to end, in-process (supertest, no port, no tunnel,
 * no Lemon Squeezy): the real route, raw-body capture, X-Signature check, event mapping and
 * subscription service, with a Lemon Squeezy provider built from test-only secrets. The suite's
 * environment stays BILLING_PROVIDER=mock (jest.setup.env.ts refuses anything else); only this file
 * swaps the provider module. The one outbound call the service makes (retrieveSubscription, on a
 * checkout completion) is stubbed; any other fetch would throw.
 *
 * Payload shapes follow the deliveries the test-mode store sent on 2026-11-07. jest.mock is hoisted
 * above the imports, so the secrets are repeated as literals in the factory.
 */
jest.mock("../billing/index.js", () => {
  const { LemonSqueezyBillingProvider } = jest.requireActual<typeof import("../billing/LemonSqueezyBillingProvider.js")>("../billing/LemonSqueezyBillingProvider.js");
  const lemonSqueezy = new LemonSqueezyBillingProvider(
    "test-only-api-key",
    "test-only-lsq-webhook-secret",
    "517310",
    true,
    "test-only-lsq-checkout-secret-0123456789",
    "https://lsq.invalid"
  );
  return {
    getBillingProvider: () => lemonSqueezy,
    getMockBillingProvider: () => {
      throw new Error("The mock billing driver is only available when BILLING_PROVIDER=mock.");
    },
    shouldWarnAboutMockBillingProviderInProduction: () => false,
  };
});
const WEBHOOK_SECRET = "test-only-lsq-webhook-secret";

const app = createApp();
const lemonSqueezy = getBillingProvider() as LemonSqueezyBillingProvider;
/** Tags every payload this file sends (kept in the stored meta) so cleanup finds exactly them. */
const RUN = `lsqhttp_${new mongoose.Types.ObjectId().toString()}`;
const ownerIds: mongoose.Types.ObjectId[] = [];
let starter: Awaited<ReturnType<typeof createTestPlan>>;
let growth: Awaited<ReturnType<typeof createTestPlan>>;
let seq = 0;

// Numeric like real variant ids, and unique to this run (plans are looked up by providerPriceId).
const base = 700_000_000 + Math.floor(Math.random() * 90_000_000);
const STARTER_MONTHLY = String(base + 1);
const STARTER_YEARLY = String(base + 2);
const GROWTH_MONTHLY = String(base + 3);

beforeAll(async () => {
  await connectDB();
  starter = await createTestPlan({
    pricing: [
      { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: STARTER_MONTHLY },
      { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: STARTER_YEARLY },
    ],
  });
  growth = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: GROWTH_MONTHLY }] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingWebhookEvent.deleteMany({ "payload.meta.test_run": RUN }),
    Plan.deleteMany({ _id: { $in: [starter._id, growth._id] } }),
  ]);
  await closeTestConnections();
});

function newOwner() {
  const ownerId = new mongoose.Types.ObjectId();
  ownerIds.push(ownerId);
  return ownerId;
}

function newSubscriptionId() {
  seq += 1;
  return String(base * 10 + seq);
}

/** Strictly increasing updated_at values, well in the past (so an unknown reference isn't retried). */
let clock = Date.UTC(2026, 10, 7, 10, 0, 0);
const tick = () => new Date((clock += 1000)).toISOString();

/** The custom data our own createCheckoutSession signs, captured from the request it would send. */
async function signedCheckout(ownerId: mongoose.Types.ObjectId, variantId = STARTER_MONTHLY, planCode = starter.code, billingInterval = "monthly") {
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    status: 201,
    ok: true,
    json: async () => ({ data: { attributes: { url: "https://garnishtable.lemonsqueezy.com/checkout/custom/test" } } }),
  } as unknown as Response);
  await lemonSqueezy.createCheckoutSession({
    providerCustomerId: `pending_checkout:business:${ownerId.toString()}`,
    providerPriceId: variantId,
    metadata: { ownerType: "business", ownerId: ownerId.toString(), planCode, billingInterval },
    successUrl: "https://admin.example.test/billing-checkout-complete",
    cancelUrl: "https://admin.example.test/billing",
  });
  const custom = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string).data.attributes.checkout_data.custom as Record<string, unknown>;
  fetchSpy.mockRestore();
  return custom;
}

/** What retrieveSubscription would report for a just-paid checkout. */
function stubRetrieveSubscription() {
  return jest.spyOn(lemonSqueezy, "retrieveSubscription").mockImplementation(async (providerSubscriptionId: string) => ({
    providerSubscriptionId,
    status: "active",
    currentPeriodStart: new Date("2026-11-07T10:00:00Z"),
    currentPeriodEnd: new Date("2026-12-07T10:00:00Z"),
  }));
}

const signedUrls = (subscriptionId: string) => ({
  customer_portal: `https://garnishtable.lemonsqueezy.com/billing?expires=1&user=1&signature=portal${subscriptionId}`,
  update_payment_method: `https://garnishtable.lemonsqueezy.com/subscription/${subscriptionId}/payment-details?expires=1&signature=card${subscriptionId}`,
  customer_portal_update_subscription: `https://garnishtable.lemonsqueezy.com/billing/${subscriptionId}/update?expires=1&signature=plan${subscriptionId}`,
});

function subscriptionEvent(
  eventName: string,
  subscriptionId: string,
  attributes: Record<string, unknown>,
  customData?: Record<string, unknown>,
  webhookId = new mongoose.Types.ObjectId().toString()
) {
  return {
    meta: { test_mode: true, event_name: eventName, webhook_id: webhookId, test_run: RUN, ...(customData ? { custom_data: customData } : {}) },
    data: {
      type: "subscriptions",
      id: subscriptionId,
      attributes: {
        status: "active",
        cancelled: false,
        customer_id: 10336616,
        variant_id: Number(STARTER_MONTHLY),
        renews_at: "2026-12-07T10:00:00.000000Z",
        ends_at: null,
        trial_ends_at: null,
        created_at: "2026-11-07T10:00:00.000000Z",
        updated_at: tick(),
        test_mode: true,
        urls: signedUrls(subscriptionId),
        ...attributes,
      },
    },
  };
}

function invoiceEvent(eventName: string, subscriptionId: string, invoiceId: string, status: string, billingReason: string) {
  return {
    meta: { test_mode: true, event_name: eventName, webhook_id: new mongoose.Types.ObjectId().toString(), test_run: RUN },
    data: {
      type: "subscription-invoices",
      id: invoiceId,
      attributes: {
        subscription_id: Number(subscriptionId),
        customer_id: 10336616,
        billing_reason: billingReason,
        status,
        total: 5900,
        currency: "USD",
        created_at: tick(),
        updated_at: tick(),
        test_mode: true,
        urls: { invoice_url: `https://app.lemonsqueezy.com/my-orders/x/subscription-invoice/${invoiceId}?expires=1&signature=inv${invoiceId}` },
      },
    },
  };
}

/** Signs exactly as Lemon Squeezy does: hex HMAC-SHA256 of the raw body in X-Signature. */
function post(payload: { meta: { event_name: string } }, secret: string | null = WEBHOOK_SECRET, rawBody = JSON.stringify(payload)) {
  const req = request(app).post("/api/v1/webhooks/billing/lemonsqueezy").set("Content-Type", "application/json").set("X-Event-Name", payload.meta.event_name);
  if (secret !== null) req.set("X-Signature", createHmac("sha256", secret).update(rawBody).digest("hex"));
  return req.send(rawBody);
}

const storedEvents = (subscriptionId: string) =>
  BillingWebhookEvent.find({ "payload.meta.test_run": RUN, $or: [{ "payload.data.id": subscriptionId }, { "payload.data.attributes.subscription_id": Number(subscriptionId) }] }).lean();
const historyTypes = async (ownerId: mongoose.Types.ObjectId) => (await BillingHistoryEvent.find({ ownerId }).sort({ _id: 1 }).lean()).map((h) => h.type);
const subscriptionOf = (ownerId: mongoose.Types.ObjectId) => Subscription.findOne({ ownerId }).lean();

/** A paid checkout for `ownerId`, linked through the real route. */
async function purchase(ownerId: mongoose.Types.ObjectId) {
  const subscriptionId = newSubscriptionId();
  stubRetrieveSubscription();
  const res = await post(subscriptionEvent("subscription_created", subscriptionId, {}, await signedCheckout(ownerId)));
  expect(res.status).toBe(200);
  return subscriptionId;
}

describe("POST /webhooks/billing/lemonsqueezy — signature over the raw body", () => {
  it("accepts a correctly signed delivery with 200", async () => {
    const payload = subscriptionEvent("subscription_updated", newSubscriptionId(), {});
    const res = await post(payload);
    expect({ status: res.status, body: res.body }).toEqual({ status: 200, body: { received: true } });
  });

  it("rejects a wrong secret, a missing signature and a body changed after signing with 400, storing nothing", async () => {
    const subscriptionId = newSubscriptionId();
    const payload = subscriptionEvent("subscription_updated", subscriptionId, {});
    const tampered = JSON.stringify(payload).replace(`"status":"active"`, `"status":"expired"`);

    expect((await post(payload, "wrong-secret")).status).toBe(400);
    expect((await post(payload, null)).status).toBe(400);
    const signedOriginal = createHmac("sha256", WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
    const changed = await request(app)
      .post("/api/v1/webhooks/billing/lemonsqueezy")
      .set("Content-Type", "application/json")
      .set("X-Signature", signedOriginal)
      .send(tampered);
    expect(changed.status).toBe(400);
    expect(await storedEvents(subscriptionId)).toHaveLength(0);
  });

  it("verifies the exact bytes received — the same JSON re-spaced still needs its own signature", async () => {
    const payload = subscriptionEvent("subscription_updated", newSubscriptionId(), {});
    const spaced = JSON.stringify(payload, null, 2);
    expect((await post(payload, WEBHOOK_SECRET, spaced)).status).toBe(200);
    const signedCompact = createHmac("sha256", WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
    const res = await request(app).post("/api/v1/webhooks/billing/lemonsqueezy").set("Content-Type", "application/json").set("X-Signature", signedCompact).send(spaced);
    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/billing/lemonsqueezy — subscription lifecycle", () => {
  it("created → updated (plan change) → cancelled → resumed → cancelled → expired", async () => {
    const ownerId = newOwner();
    const subscriptionId = await purchase(ownerId);

    let sub = (await subscriptionOf(ownerId))!;
    expect(sub).toMatchObject({
      status: "active",
      provider: "lemonsqueezy",
      providerSubscriptionId: subscriptionId,
      providerCustomerId: "10336616",
      billingInterval: "monthly",
      currentPeriodEnd: new Date("2026-12-07T10:00:00Z"),
    });
    expect(String(sub.planId)).toBe(String(starter._id));
    expect(await historyTypes(ownerId)).toEqual(["subscription_created", "payment_succeeded"]);

    expect((await post(subscriptionEvent("subscription_updated", subscriptionId, { variant_id: Number(GROWTH_MONTHLY) }))).status).toBe(200);
    sub = (await subscriptionOf(ownerId))!;
    expect(String(sub.planId)).toBe(String(growth._id));
    expect(sub.status).toBe("active");

    const endsAt = "2026-12-07T10:00:00.000000Z";
    expect((await post(subscriptionEvent("subscription_cancelled", subscriptionId, { status: "cancelled", cancelled: true, ends_at: endsAt, variant_id: Number(GROWTH_MONTHLY) }))).status).toBe(200);
    sub = (await subscriptionOf(ownerId))!;
    expect(sub.status).toBe("cancelling");
    expect(sub.cancelAt).toEqual(new Date(endsAt));

    expect((await post(subscriptionEvent("subscription_resumed", subscriptionId, { variant_id: Number(GROWTH_MONTHLY) }))).status).toBe(200);
    sub = (await subscriptionOf(ownerId))!;
    expect(sub.status).toBe("active");
    expect(sub.cancelAt).toBeUndefined();

    expect((await post(subscriptionEvent("subscription_cancelled", subscriptionId, { status: "cancelled", cancelled: true, ends_at: endsAt, variant_id: Number(GROWTH_MONTHLY) }))).status).toBe(200);
    expect((await post(subscriptionEvent("subscription_expired", subscriptionId, { status: "expired", cancelled: true, ends_at: endsAt, variant_id: Number(GROWTH_MONTHLY) }))).status).toBe(200);
    sub = (await subscriptionOf(ownerId))!;
    expect(sub.status).toBe("cancelled");

    expect(await historyTypes(ownerId)).toEqual([
      "subscription_created",
      "payment_succeeded",
      "plan_changed",
      "cancellation_requested",
      "reactivated",
      "cancellation_requested",
      "cancelled",
    ]);
    const rows = await storedEvents(subscriptionId);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.processedAt && !r.processingError)).toBe(true);
  });

  it("an older event arriving late is acknowledged but cannot undo newer state", async () => {
    const ownerId = newOwner();
    const subscriptionId = await purchase(ownerId);
    const stale = subscriptionEvent("subscription_cancelled", subscriptionId, { status: "cancelled", ends_at: "2026-12-07T10:00:00.000000Z" });
    const newer = subscriptionEvent("subscription_resumed", subscriptionId, {});

    expect((await post(newer)).status).toBe(200);
    expect((await post(stale)).status).toBe(200);

    expect((await subscriptionOf(ownerId))!.status).toBe("active");
    const staleRow = (await storedEvents(subscriptionId)).find((r) => r.eventType === "subscription_cancelled");
    expect(staleRow?.processingError).toMatch(/older than the subscription state already applied/);
  });
});

describe("POST /webhooks/billing/lemonsqueezy — failed payment and recovery", () => {
  it("payment failed → past_due → renewal paid → active, with the period rolled forward and one payment row per invoice", async () => {
    const ownerId = newOwner();
    const subscriptionId = await purchase(ownerId);

    expect((await post(invoiceEvent("subscription_payment_failed", subscriptionId, `${subscriptionId}1`, "pending", "renewal"))).status).toBe(200);
    expect((await subscriptionOf(ownerId))!.status).toBe("active"); // the invoice alone changes nothing
    expect((await post(subscriptionEvent("subscription_updated", subscriptionId, { status: "past_due" }))).status).toBe(200);
    expect((await subscriptionOf(ownerId))!.status).toBe("past_due");

    const paid = invoiceEvent("subscription_payment_success", subscriptionId, `${subscriptionId}2`, "paid", "renewal");
    expect((await post(paid)).status).toBe(200);
    expect((await post(paid)).status).toBe(200); // a redelivery records nothing more
    expect((await post(subscriptionEvent("subscription_updated", subscriptionId, { status: "active", renews_at: "2027-01-07T10:00:00.000000Z" }))).status).toBe(200);

    const sub = (await subscriptionOf(ownerId))!;
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodStart).toEqual(new Date("2026-12-07T10:00:00Z"));
    expect(sub.currentPeriodEnd).toEqual(new Date("2027-01-07T10:00:00Z"));

    const history = await BillingHistoryEvent.find({ ownerId }).sort({ _id: 1 }).lean();
    expect(history.map((h) => h.type)).toEqual(["subscription_created", "payment_succeeded", "payment_failed", "payment_succeeded", "payment_succeeded"]);
    // The recovery itself (past_due → active) and the renewal invoice are two rows by the shared
    // service's design; the invoice row is the one keyed by the invoice, so it is never doubled.
    expect(history.filter((h) => h.providerReference === `${subscriptionId}2`)).toHaveLength(1);
  });
});

describe("POST /webhooks/billing/lemonsqueezy — checkout ownership (H1)", () => {
  it("rejects checkout data altered to another account: nothing is linked, the event is recorded and alerted on", async () => {
    const attacker = newOwner();
    const victim = newOwner();
    const subscriptionId = newSubscriptionId();
    const errorLog = jest.spyOn(logger, "error");
    const retrieve = stubRetrieveSubscription();

    const custom = { ...(await signedCheckout(attacker)), ownerId: victim.toString() };
    expect((await post(subscriptionEvent("subscription_created", subscriptionId, {}, custom))).status).toBe(200);

    expect(await Subscription.countDocuments({ ownerId: { $in: [attacker, victim] } })).toBe(0);
    expect(await Subscription.countDocuments({ provider: "lemonsqueezy", providerSubscriptionId: subscriptionId })).toBe(0);
    expect(retrieve).not.toHaveBeenCalled();
    const [row] = await storedEvents(subscriptionId);
    expect(row.processedAt).toBeTruthy();
    expect(row.processingError).toMatch(/^Rejected: checkout data signature does not match/);
    expect(errorLog).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ alert: BILLING_ALERT_REJECTED_EVENT, providerSubscriptionId: subscriptionId }));
  });

  it("cannot take over another account's trial", async () => {
    const attacker = newOwner();
    const victim = newOwner();
    const trial = await createTestSubscription("business", victim, starter._id, { status: "trialing", trialEnd: new Date(Date.now() + 7 * 864e5) });
    stubRetrieveSubscription();

    const custom = { ...(await signedCheckout(attacker)), ownerId: victim.toString() };
    expect((await post(subscriptionEvent("subscription_created", newSubscriptionId(), {}, custom))).status).toBe(200);

    const after = (await Subscription.findById(trial._id).lean())!;
    expect(after.status).toBe("trialing");
    expect(after.provider).toBe("mock");
    expect(after.providerSubscriptionId).toBeUndefined();
    expect(await Subscription.countDocuments({ ownerId: victim })).toBe(1);
  });

  it("rejects a dearer plan claimed on a cheaper purchase, a signed checkout used for another variant, and a public-link purchase", async () => {
    const ownerId = newOwner();
    stubRetrieveSubscription();
    const signed = await signedCheckout(ownerId);
    const cases: Array<[Record<string, unknown> | undefined, Record<string, unknown>, RegExp]> = [
      [{ ...signed, planCode: growth.code }, {}, /signature does not match/],
      [signed, { variant_id: Number(STARTER_YEARLY) }, /purchased variant .* is not the checkout's signed variant/],
      [{ ownerType: "business", ownerId: ownerId.toString(), planCode: growth.code, billingInterval: "monthly", variantId: GROWTH_MONTHLY }, { variant_id: Number(GROWTH_MONTHLY) }, /without complete signed GarnishTable checkout data/],
      [undefined, {}, /without complete signed GarnishTable checkout data/],
    ];
    for (const [custom, attributes, reason] of cases) {
      const subscriptionId = newSubscriptionId();
      expect((await post(subscriptionEvent("subscription_created", subscriptionId, attributes, custom))).status).toBe(200);
      const [row] = await storedEvents(subscriptionId);
      expect(row.processingError).toMatch(reason);
    }
    expect(await Subscription.countDocuments({ ownerId })).toBe(0);
  });

  it("control: the untouched signed checkout links normally", async () => {
    const ownerId = newOwner();
    const subscriptionId = await purchase(ownerId);
    expect((await subscriptionOf(ownerId))!.providerSubscriptionId).toBe(subscriptionId);
  });
});

describe("POST /webhooks/billing/lemonsqueezy — resends and duplicates", () => {
  it("a dashboard resend (new meta.webhook_id) of subscription_created or subscription_updated is not processed twice", async () => {
    const ownerId = newOwner();
    const subscriptionId = newSubscriptionId();
    const retrieve = stubRetrieveSubscription();
    const created = subscriptionEvent("subscription_created", subscriptionId, {}, await signedCheckout(ownerId), "webhook-1");
    const createdResend = { ...created, meta: { ...created.meta, webhook_id: "webhook-2" } };
    const updated = subscriptionEvent("subscription_updated", subscriptionId, { status: "past_due" }, undefined, "webhook-3");
    const updatedResend = { ...updated, meta: { ...updated.meta, webhook_id: "webhook-4" } };

    for (const payload of [created, createdResend, updated, updatedResend]) expect((await post(payload)).status).toBe(200);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(await Subscription.countDocuments({ ownerId })).toBe(1);
    expect(await historyTypes(ownerId)).toEqual(["subscription_created", "payment_succeeded", "payment_failed"]);
    const rows = await storedEvents(subscriptionId);
    expect(rows.map((r) => r.eventType).sort()).toEqual(["subscription_created", "subscription_updated"]);
  });

  it("a second paid purchase by an owner who already has a subscription is recorded and alerted on, never silently dropped or linked", async () => {
    const ownerId = newOwner();
    const first = await purchase(ownerId);
    const second = newSubscriptionId();
    const errorLog = jest.spyOn(logger, "error");

    expect((await post(subscriptionEvent("subscription_created", second, {}, await signedCheckout(ownerId)))).status).toBe(200);

    expect(await Subscription.countDocuments({ ownerId })).toBe(1);
    expect((await subscriptionOf(ownerId))!.providerSubscriptionId).toBe(first);
    const [row] = await storedEvents(second);
    expect(row.processingError).toMatch(/^Duplicate purchase: owner already has live subscription .*provider subscription \d+ is NOT linked/);
    expect(errorLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ alert: BILLING_ALERT_DUPLICATE_PURCHASE, ownerId: ownerId.toString(), unlinkedProviderSubscriptionId: second, existingProviderSubscriptionId: first })
    );
    expect(await historyTypes(ownerId)).toEqual(["subscription_created", "payment_succeeded"]);
  });
});

describe("POST /webhooks/billing/lemonsqueezy — stored payloads (M3)", () => {
  it("never stores the pre-signed portal, payment-update or invoice links, and keeps what processing needs", async () => {
    const ownerId = newOwner();
    const subscriptionId = await purchase(ownerId);
    expect((await post(invoiceEvent("subscription_payment_success", subscriptionId, `${subscriptionId}9`, "paid", "renewal"))).status).toBe(200);

    const rows = await storedEvents(subscriptionId);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const payload = row.payload as { meta: Record<string, unknown>; data: { id: string; attributes: Record<string, unknown> } };
      expect(payload.data.attributes).not.toHaveProperty("urls");
      expect(JSON.stringify(payload)).not.toMatch(/signature=/);
      expect(payload.meta.event_name).toBe(row.eventType);
      expect(payload.meta.webhook_id).toBeTruthy();
    }
    const created = rows.find((r) => r.eventType === "subscription_created")!.payload as { data: { attributes: Record<string, unknown> } };
    expect(created.data.attributes).toMatchObject({ status: "active", variant_id: Number(STARTER_MONTHLY), customer_id: 10336616 });
  });
});
