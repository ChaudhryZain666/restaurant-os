// Held / waiting refunds: provider lookup, re-issue, webhooks, staff resolution, and the accounting
// rules behind them (payment.service.ts — reconcileRefund, resolveHeldRefund, applyRefundOutcome).
// The mock provider stands in for Stripe-like behavior (lookup + idempotency); a Safepay-like
// provider is simulated by switching its capability flags off.
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB } from "../config/db.js";
import { AuditLog } from "../models/AuditLog.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { Refund } from "../models/Refund.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getMockPaymentProvider } from "../payments/index.js";
import { ProviderRequestError } from "../payments/PaymentProvider.js";
import {
  MANUAL_NOT_REFUNDED_MIN_HOLD_MS,
  PROVIDER_IDEMPOTENCY_WINDOW_MS,
  STALE_REFUND_CLAIM_MS,
  processProviderEvent,
  providerRefundIdempotencyKey,
} from "../services/payment.service.js";
import { closeTestConnections, createTestOrder, createTestRestaurant, createTestUser, tokenFor } from "../test-utils/fixtures.js";

// Several tests drive a dozen real HTTP round-trips each (≈1–3 s warm); the 5 s default was
// exceeded on cold or loaded runs.
jest.setTimeout(30_000);

const app = createApp();
const mock = getMockPaymentProvider();

let restaurantA: Awaited<ReturnType<typeof createTestRestaurant>>;
let restaurantB: Awaited<ReturnType<typeof createTestRestaurant>>;
let ownerAToken: string;
let ownerAId: string;
let staffAToken: string;
let ownerBToken: string;
let platformToken: string;
let customerToken: string;
let customerId: string;
const userIds: string[] = [];

beforeAll(async () => {
  await connectDB();
  restaurantA = await createTestRestaurant({ settings: { currency: "USD" } });
  restaurantB = await createTestRestaurant({ settings: { currency: "USD" } });
  const ownerA = await createTestUser("restaurant_owner", restaurantA._id);
  const staffA = await createTestUser("restaurant_staff", restaurantA._id);
  const ownerB = await createTestUser("restaurant_owner", restaurantB._id);
  const platform = await createTestUser("platform_admin");
  const customer = await createTestUser("customer");
  userIds.push(...[ownerA, staffA, ownerB, platform, customer].map((u) => u.id as string));
  ownerAToken = tokenFor(ownerA);
  ownerAId = ownerA.id;
  staffAToken = tokenFor(staffA);
  ownerBToken = tokenFor(ownerB);
  platformToken = tokenFor(platform);
  customerToken = tokenFor(customer);
  customerId = customer.id;
});

afterAll(async () => {
  const ids = [restaurantA._id, restaurantB._id];
  await Promise.all([
    Payment.deleteMany({ restaurantId: { $in: ids } }),
    Refund.deleteMany({ restaurantId: { $in: ids } }),
    Order.deleteMany({ restaurantId: { $in: ids } }),
    AuditLog.deleteMany({ restaurantId: { $in: ids } }),
    Restaurant.deleteMany({ _id: { $in: ids } }),
  ]);
  await User.deleteMany({ _id: { $in: userIds } });
  await closeTestConnections();
});

async function paidPayment(total = 40) {
  const order = await createTestOrder(restaurantA._id, new mongoose.Types.ObjectId(customerId), { paymentMethod: "online", total });
  const created = await request(app)
    .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ idempotencyKey: `paid-setup-${order.id}` });
  const paymentId = created.body.data.payment.id;
  await request(app)
    .post(`/api/v1/restaurants/${restaurantA.id}/orders/${order.id}/payments/${paymentId}/mock-complete`)
    .set("Authorization", `Bearer ${customerToken}`)
    .send({ outcome: "paid" });
  return { order, payment: (await Payment.findById(paymentId))! };
}

const base = (orderId: string, paymentId: string) => `/api/v1/restaurants/${restaurantA.id}/orders/${orderId}/payments/${paymentId}`;
const post = (url: string, token: string, body: object = {}) => request(app).post(url).set("Authorization", `Bearer ${token}`).send(body);
const get = (url: string, token: string) => request(app).get(url).set("Authorization", `Bearer ${token}`);
const reserved = async (paymentId: unknown) => (await Payment.findById(paymentId))!.totalRefunded;

/** Issues a refund whose provider call ends with an unknown outcome. `processed` = the provider had
 *  actually made the refund before the connection dropped. */
async function heldRefund(amount = 25, { processed = false } = {}) {
  const { order, payment } = await paidPayment(40);
  const key = `held-${payment.id}`;
  const original = mock.refund.bind(mock);
  const spy = jest.spyOn(mock, "refund").mockImplementationOnce(async (...args) => {
    if (processed) await original(...args);
    throw new ProviderRequestError("Stripe request timed out", "unknown");
  });
  const res = await post(`${base(order.id, payment.id)}/refund`, ownerAToken, { idempotencyKey: key, amount });
  spy.mockRestore();
  expect(res.status).toBe(503);
  const refund = (await Refund.findOne({ paymentId: payment._id }))!;
  return { order, payment, key, refund, providerKey: providerRefundIdempotencyKey(restaurantA.id, key) };
}

async function backdate(refundId: unknown, ms: number, field: "createdAt" | "lastLookupAt" = "createdAt") {
  await Refund.collection.updateOne({ _id: refundId as mongoose.Types.ObjectId }, { $set: { [field]: new Date(Date.now() - ms) } });
}

function withCapabilities<T>(caps: { supportsRefundLookup?: boolean; supportsRefundIdempotency?: boolean }, fn: () => Promise<T>) {
  const saved = { supportsRefundLookup: mock.supportsRefundLookup, supportsRefundIdempotency: mock.supportsRefundIdempotency };
  for (const [k, v] of Object.entries(caps)) Object.defineProperty(mock, k, { value: v, configurable: true });
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) Object.defineProperty(mock, k, { value: v, configurable: true });
  });
}

const auditFor = (refundId: string, action: string) => AuditLog.find({ action, "metadata.refundId": refundId }).lean();

describe("staff view of held refunds", () => {
  it("lists a held refund with provider, amount, status and the next action", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const res = await get(`${base(order.id, payment.id)}/refunds`, ownerAToken);
    expect(res.status).toBe(200);
    expect(res.body.data.refunds).toHaveLength(1);
    expect(res.body.data.refunds[0]).toMatchObject({
      id: refund.id,
      provider: "mock",
      amount: 25,
      status: "pending",
      providerOutcomeUnknown: true,
      reconciliation: { held: true, canCheckWithProvider: true, canRetry: true },
    });
    expect(res.body.data.refunds[0].reconciliation.nextAction).toMatch(/On hold/);
    // The hold itself is audited.
    expect(await auditFor(refund.id, "payment.refund_held")).toHaveLength(1);
  });

  it("platform admins see waiting refunds across restaurants, with restaurant and order", async () => {
    const { order, refund } = await heldRefund(10);
    const res = await get("/api/v1/platform/refunds/waiting", platformToken);
    expect(res.status).toBe(200);
    const row = res.body.data.refunds.find((r: { id: string }) => r.id === refund.id);
    expect(row).toMatchObject({ restaurantName: restaurantA.name, orderNumber: order.orderNumber, reconciliation: { held: true } });
  });

  it("a restaurant owner can't use the platform view", async () => {
    expect((await get("/api/v1/platform/refunds/waiting", ownerAToken)).status).toBe(403);
  });
});

describe("authorization", () => {
  it("staff without restaurant.payments.manage can't list, check, retry or resolve refunds", async () => {
    const { order, payment, refund } = await heldRefund(10);
    const url = base(order.id, payment.id);
    expect((await get(`${url}/refunds`, staffAToken)).status).toBe(403);
    expect((await post(`${url}/refunds/${refund.id}/check`, staffAToken)).status).toBe(403);
    expect((await post(`${url}/refunds/${refund.id}/retry`, staffAToken)).status).toBe(403);
    expect((await post(`${url}/refunds/${refund.id}/resolve`, staffAToken, { outcome: "refunded", providerRefundRef: "re_x", evidence: "seen in dashboard" })).status).toBe(403);
  });

  it("another restaurant's owner can't reach the refund, even with its ids", async () => {
    const { order, payment, refund } = await heldRefund(10);
    const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerBToken);
    expect(res.status).toBe(403);
    // ...and through their own restaurant's URL the refund isn't found.
    const viaB = await post(`/api/v1/restaurants/${restaurantB.id}/orders/${order.id}/payments/${payment.id}/refunds/${refund.id}/check`, ownerBToken);
    expect(viaB.status).toBe(404);
  });

  it("platform admins can check a refund with the provider", async () => {
    const { refund } = await heldRefund(10, { processed: true });
    const res = await post(`/api/v1/platform/refunds/${refund.id}/check`, platformToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ outcome: "found", refund: { status: "succeeded" } });
  });
});

describe("provider lookup (Stripe-like: lookup + idempotency)", () => {
  it("finds a refund that DID go through: succeeded, counted once, never refunded again", async () => {
    const { order, payment, refund } = await heldRefund(25, { processed: true });
    const spy = jest.spyOn(mock, "refund");
    try {
      const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
      expect(res.status).toBe(200);
      expect(res.body.data.outcome).toBe("found");
      expect(res.body.data.refund).toMatchObject({ status: "succeeded", resolution: { method: "provider_lookup", outcome: "refunded" } });
      expect(spy).not.toHaveBeenCalled();
      const stored = await Payment.findById(payment._id);
      expect(stored!.totalRefunded).toBe(25);
      expect(stored!.status).toBe("partially_refunded");
      const audits = await auditFor(refund.id, "payment.refund_reconciled");
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata).toMatchObject({ from: "pending", to: "succeeded", method: "provider_lookup" });
    } finally {
      spy.mockRestore();
    }
  });

  it("an inconclusive lookup (timeout / error) never counts as 'not found': the refund stays held and reserved", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const spy = jest.spyOn(mock, "lookupRefund").mockRejectedValue(new ProviderRequestError("Couldn't confirm the refund with Stripe: timed out", "unknown"));
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const check = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
      expect(check.body.data.outcome).toBe("inconclusive");
      // A retry must not re-issue on an inconclusive lookup either.
      const retry = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/retry`, ownerAToken);
      expect(retry.body.data.outcome).toBe("inconclusive");
      expect(refundSpy).not.toHaveBeenCalled();
      const stored = (await Refund.findById(refund._id))!;
      expect(stored).toMatchObject({ status: "pending", providerOutcomeUnknown: true, lastLookupResult: "inconclusive" });
      expect(await reserved(payment._id)).toBe(25);
    } finally {
      spy.mockRestore();
      refundSpy.mockRestore();
    }
  });

  it("not found: 'Check' only records the evidence — it never moves money or releases anything", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
      expect(res.body.data.outcome).toBe("not_found");
      expect(refundSpy).not.toHaveBeenCalled();
      expect((await Refund.findById(refund._id))!).toMatchObject({ status: "pending", providerOutcomeUnknown: true, lastLookupResult: "not_found" });
      expect(await reserved(payment._id)).toBe(25);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it("retry re-issues a definitively-missing refund once, with the SAME provider key, inside the idempotency window", async () => {
    const { order, payment, refund, providerKey } = await heldRefund(25);
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/retry`, ownerAToken);
      expect(res.body.data.outcome).toBe("reissued");
      expect(res.body.data.refund.status).toBe("succeeded");
      expect(refundSpy).toHaveBeenCalledTimes(1);
      expect((refundSpy.mock.calls[0][3] as { idempotencyKey: string }).idempotencyKey).toBe(providerKey);
      expect(await reserved(payment._id)).toBe(25);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it("concurrent retries re-issue at most once", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const url = `${base(order.id, payment.id)}/refunds/${refund.id}/retry`;
      const results = await Promise.all([post(url, ownerAToken), post(url, ownerAToken), post(url, ownerAToken)]);
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(refundSpy).toHaveBeenCalledTimes(1);
      const stored = await Payment.findById(payment._id);
      expect(stored!.totalRefunded).toBe(25);
      expect((await Refund.findById(refund._id))!.status).toBe("succeeded");
    } finally {
      refundSpy.mockRestore();
    }
  });

  it("a refusal while re-issuing keeps the refund held (a same-key 4xx doesn't prove there's no refund)", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const refundSpy = jest.spyOn(mock, "refund").mockRejectedValueOnce(new ProviderRequestError("Keys for idempotent requests can only be used with the same parameters", "rejected"));
    try {
      const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/retry`, ownerAToken);
      expect(res.body.data.outcome).toBe("inconclusive");
      expect((await Refund.findById(refund._id))!).toMatchObject({ status: "pending", providerOutcomeUnknown: true });
      expect(await reserved(payment._id)).toBe(25);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it("past the provider's idempotency window, retry never re-issues — a person must decide", async () => {
    const { order, payment, refund } = await heldRefund(25);
    await backdate(refund._id, PROVIDER_IDEMPOTENCY_WINDOW_MS + 60_000);
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const list = await get(`${base(order.id, payment.id)}/refunds`, ownerAToken);
      expect(list.body.data.refunds[0].reconciliation.canRetry).toBe(false);
      const res = await post(`${base(order.id, payment.id)}/refunds/${refund.id}/retry`, ownerAToken);
      expect(res.body.data.outcome).toBe("not_found");
      expect(refundSpy).not.toHaveBeenCalled();
      expect(await reserved(payment._id)).toBe(25);
    } finally {
      refundSpy.mockRestore();
    }
  });

  it("a same-key retry of the original request also goes lookup-first (and holds when the lookup is inconclusive)", async () => {
    const { order, payment, key, refund } = await heldRefund(25);
    const lookup = jest.spyOn(mock, "lookupRefund").mockRejectedValue(new ProviderRequestError("timed out", "unknown"));
    const refundSpy = jest.spyOn(mock, "refund");
    try {
      const res = await post(`${base(order.id, payment.id)}/refund`, ownerAToken, { idempotencyKey: key, amount: 25 });
      expect(res.body.data.refund).toMatchObject({ id: refund.id, status: "pending", providerOutcomeUnknown: true });
      expect(res.body.data.reconciliation.held).toBe(true);
      expect(refundSpy).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      refundSpy.mockRestore();
    }
  });
});

describe("pending at the provider (incl. requires_action)", () => {
  async function pendingAtProvider(providerStatus: string) {
    const { order, payment } = await paidPayment(40);
    const key = `pending-${payment.id}`;
    const providerKey = providerRefundIdempotencyKey(restaurantA.id, key);
    const original = mock.refund.bind(mock);
    const spy = jest.spyOn(mock, "refund").mockImplementationOnce(async (...args) => {
      await original(...args);
      mock.setRefundStatusForTest(providerKey, "pending", providerStatus);
      return { ...(await original(...args)) };
    });
    const res = await post(`${base(order.id, payment.id)}/refund`, ownerAToken, { idempotencyKey: key, amount: 20 });
    spy.mockRestore();
    return { order, payment, res, providerKey, refund: (await Refund.findOne({ paymentId: payment._id }))! };
  }

  it("keeps the reservation, doesn't mark the payment refunded, and shows it as waiting", async () => {
    const { order, payment, res } = await pendingAtProvider("requires_action");
    expect(res.status).toBe(201);
    expect(res.body.data.refund).toMatchObject({ status: "pending", providerStatus: "requires_action" });
    expect(res.body.data.reconciliation).toMatchObject({ waitingOnProvider: true, held: false });
    const stored = await Payment.findById(payment._id);
    expect(stored!.totalRefunded).toBe(20);
    expect(stored!.status).toBe("paid");
    // No "refunded" audit for a refund that hasn't happened.
    expect(await AuditLog.countDocuments({ action: "payment.refunded", targetId: payment._id })).toBe(0);
    // And a second refund on the payment is blocked with a clear message.
    const other = await post(`${base(order.id, payment.id)}/refund`, ownerAToken, { idempotencyKey: `other-${payment.id}`, amount: 5 });
    expect(other.status).toBe(409);
    expect(other.body.error.message).toMatch(/waiting to be confirmed by mock/);
  });

  it("pending → failed (via lookup) releases the reservation exactly once", async () => {
    const { order, payment, refund, providerKey } = await pendingAtProvider("pending");
    mock.setRefundStatusForTest(providerKey, "failed", "canceled");
    const url = `${base(order.id, payment.id)}/refunds/${refund.id}/check`;
    await Promise.all([post(url, ownerAToken), post(url, ownerAToken)]);
    await post(url, ownerAToken);
    const stored = (await Refund.findById(refund._id))!;
    expect(stored).toMatchObject({ status: "failed", providerStatus: "canceled" });
    const p = await Payment.findById(payment._id);
    expect(p!.totalRefunded).toBe(0);
    expect(p!.status).toBe("paid");
    expect(await auditFor(refund.id, "payment.refund_reconciled")).toHaveLength(1);
  });

  it("pending → succeeded (via lookup) completes it and counts it once", async () => {
    const { order, payment, refund, providerKey } = await pendingAtProvider("pending");
    mock.setRefundStatusForTest(providerKey, "succeeded", "succeeded");
    await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
    const p = await Payment.findById(payment._id);
    expect(p!.totalRefunded).toBe(20);
    expect(p!.status).toBe("partially_refunded");
  });
});

describe("refund webhooks", () => {
  let n = 0;
  const event = (refundRef: string, status: "pending" | "succeeded" | "failed", extra: { refundKey?: string; eventId?: string } = {}) => ({
    eventId: extra.eventId ?? `evt_refund_${Date.now()}_${n++}`,
    eventType: "refund.updated",
    providerRef: refundRef,
    status: "pending" as const,
    raw: {},
    refund: { refundRef, status, providerStatus: status, refundKey: extra.refundKey },
  });

  it("a webhook settles a held refund found by our refund key; a duplicate delivery changes nothing", async () => {
    const { payment, refund, providerKey } = await heldRefund(25);
    const evt = event("re_from_webhook_1", "succeeded", { refundKey: providerKey });
    await processProviderEvent("mock", evt);
    await processProviderEvent("mock", evt);
    const stored = (await Refund.findById(refund._id))!;
    expect(stored).toMatchObject({ status: "succeeded", providerRefundRef: "re_from_webhook_1", resolution: { method: "webhook" } });
    expect(stored.providerOutcomeUnknown).toBeUndefined();
    expect(await reserved(payment._id)).toBe(25);
    expect(await auditFor(refund.id, "payment.refund_reconciled")).toHaveLength(1);
  });

  it("out of order: a late 'pending' after 'succeeded' never regresses it; a later 'failed' releases once", async () => {
    const { payment, refund, providerKey } = await heldRefund(25);
    await processProviderEvent("mock", event("re_ooo_1", "succeeded", { refundKey: providerKey }));
    await processProviderEvent("mock", event("re_ooo_1", "pending"));
    expect((await Refund.findById(refund._id))!.status).toBe("succeeded");
    // Stripe can report a succeeded refund as failed later — that gives the amount back, once.
    await Promise.all([processProviderEvent("mock", event("re_ooo_1", "failed")), processProviderEvent("mock", event("re_ooo_1", "failed"))]);
    expect((await Refund.findById(refund._id))!.status).toBe("failed");
    const p = await Payment.findById(payment._id);
    expect(p!.totalRefunded).toBe(0);
    expect(p!.status).toBe("paid");
  });

  it("a webhook racing a lookup for the same outcome counts the refund once", async () => {
    const { order, payment, refund, providerKey } = await heldRefund(25, { processed: true });
    const [, ] = await Promise.all([
      processProviderEvent("mock", event((mock as unknown as { refundsByKey: Map<string, { refundRef: string }> }).refundsByKey.get(providerKey)!.refundRef, "succeeded", { refundKey: providerKey })),
      post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken),
    ]);
    expect((await Refund.findById(refund._id))!.status).toBe("succeeded");
    const p = await Payment.findById(payment._id);
    expect(p!.totalRefunded).toBe(25);
    expect(p!.status).toBe("partially_refunded");
  });

  it("a refund event from a different payment account is ignored", async () => {
    const { refund, providerKey } = await heldRefund(25);
    await processProviderEvent("mock", event("re_foreign_1", "failed", { refundKey: providerKey }), new mongoose.Types.ObjectId().toString());
    expect((await Refund.findById(refund._id))!).toMatchObject({ status: "pending", providerOutcomeUnknown: true });
  });
});

describe("manual resolution", () => {
  const resolveUrl = (o: string, p: string, r: string) => `${base(o, p)}/refunds/${r}/resolve`;

  it("'refunded' requires evidence and the provider's refund reference, then counts the refund once", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const url = resolveUrl(order.id, payment.id, refund.id);
    expect((await post(url, ownerAToken, { outcome: "refunded", providerRefundRef: "re_manual_1" })).status).toBe(400); // no evidence
    expect((await post(url, ownerAToken, { outcome: "refunded", evidence: "Found it in the dashboard" })).status).toBe(400); // no reference
    const ok = await post(url, ownerAToken, { outcome: "refunded", providerRefundRef: "re_manual_1", evidence: "Found it in the dashboard" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.refund).toMatchObject({
      status: "succeeded",
      providerRefundRef: "re_manual_1",
      resolution: { method: "manual", outcome: "refunded", evidence: "Found it in the dashboard", resolvedByUserId: ownerAId },
    });
    expect(await reserved(payment._id)).toBe(25);
    const audits = await auditFor(refund.id, "payment.refund_reconciled");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorUserId: new mongoose.Types.ObjectId(ownerAId), metadata: { method: "manual", evidence: "Found it in the dashboard" } });
    // Settled refunds can't be resolved again.
    expect((await post(url, ownerAToken, { outcome: "not_refunded", evidence: "changed my mind", confirmChecked: true })).status).toBe(409);
  });

  it("'not refunded' can't be clicked through: confirmation, a minimum hold and a fresh 'not found' lookup are all required", async () => {
    const { order, payment, refund } = await heldRefund(25);
    const url = resolveUrl(order.id, payment.id, refund.id);
    const body = { outcome: "not_refunded", evidence: "Not in the Stripe dashboard", confirmChecked: true };

    expect((await post(url, ownerAToken, { ...body, confirmChecked: false })).status).toBe(400);
    const tooSoon = await post(url, ownerAToken, body);
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error.message).toMatch(/minute/);

    await backdate(refund._id, MANUAL_NOT_REFUNDED_MIN_HOLD_MS + 60_000);
    const noLookup = await post(url, ownerAToken, body);
    expect(noLookup.status).toBe(409);
    expect(noLookup.body.error.message).toMatch(/Check with mock first/);

    // An inconclusive lookup doesn't count as evidence...
    const failing = jest.spyOn(mock, "lookupRefund").mockRejectedValueOnce(new ProviderRequestError("timed out", "unknown"));
    await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
    failing.mockRestore();
    expect((await post(url, ownerAToken, body)).status).toBe(409);

    // ...nor does a stale "not found".
    await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
    await backdate(refund._id, 16 * 60 * 1000, "lastLookupAt");
    expect((await post(url, ownerAToken, body)).status).toBe(409);
    expect(await reserved(payment._id)).toBe(25);

    // A fresh "not found" + confirmation + evidence releases it, once, with an audit record.
    await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
    const ok = await post(url, ownerAToken, body);
    expect(ok.status).toBe(200);
    expect(ok.body.data.refund).toMatchObject({ status: "failed", resolution: { method: "manual", outcome: "not_refunded" } });
    expect(await reserved(payment._id)).toBe(0);
    const audits = await auditFor(refund.id, "payment.refund_reconciled");
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ to: "failed", method: "manual", evidence: "Not in the Stripe dashboard" });
  });

  it("the audit record can't be edited afterwards", async () => {
    const { order, payment, refund } = await heldRefund(25, { processed: true });
    await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken);
    const [audit] = await auditFor(refund.id, "payment.refund_reconciled");
    await expect(AuditLog.updateOne({ _id: audit._id }, { $set: { "metadata.evidence": "edited" } })).rejects.toThrow(/immutable/);
    await expect(AuditLog.findOneAndUpdate({ _id: audit._id }, { $set: { actorRole: "x" } })).rejects.toThrow(/immutable/);
  });

  it("a refund still being processed can't be resolved by hand", async () => {
    const { payment, order } = await paidPayment(40);
    const inFlight = await Refund.create({
      restaurantId: restaurantA._id,
      paymentId: payment._id,
      orderId: payment.orderId,
      provider: "mock",
      amount: 5,
      status: "pending",
      idempotencyKey: `inflight-${payment.id}`,
      initiatedByUserId: ownerAId,
      amountReserved: true,
    });
    const res = await post(resolveUrl(order.id, payment.id, inFlight.id), ownerAToken, { outcome: "refunded", providerRefundRef: "re_x", evidence: "it's there in the dashboard" });
    expect(res.status).toBe(409);
    const check = await post(`${base(order.id, payment.id)}/refunds/${inFlight.id}/check`, ownerAToken);
    expect(check.body.data.outcome).toBe("in_progress");
  });
});

describe("Safepay-like provider (no lookup, no idempotency)", () => {
  it("is manual-only: no automatic check or retry, a dashboard instruction, and a confirmed manual release", async () => {
    await withCapabilities({ supportsRefundLookup: false, supportsRefundIdempotency: false }, async () => {
      const { order, payment, refund } = await heldRefund(25);
      const refundSpy = jest.spyOn(mock, "refund");
      const lookupSpy = jest.spyOn(mock, "lookupRefund");
      try {
        const list = await get(`${base(order.id, payment.id)}/refunds`, ownerAToken);
        expect(list.body.data.refunds[0].reconciliation).toMatchObject({ held: true, canCheckWithProvider: false, canRetry: false });
        expect(list.body.data.refunds[0].reconciliation.nextAction).toMatch(/dashboard/);

        expect((await post(`${base(order.id, payment.id)}/refunds/${refund.id}/check`, ownerAToken)).body.data.outcome).toBe("manual_required");
        expect((await post(`${base(order.id, payment.id)}/refunds/${refund.id}/retry`, ownerAToken)).body.data.outcome).toBe("manual_required");
        expect(refundSpy).not.toHaveBeenCalled();
        expect(lookupSpy).not.toHaveBeenCalled();

        const url = `${base(order.id, payment.id)}/refunds/${refund.id}/resolve`;
        const body = { outcome: "not_refunded", evidence: "Checked Safepay dashboard: no refund for this order", confirmChecked: true };
        expect((await post(url, ownerAToken, body)).status).toBe(409); // minimum hold still applies
        await backdate(refund._id, MANUAL_NOT_REFUNDED_MIN_HOLD_MS + 60_000);
        const ok = await post(url, ownerAToken, body);
        expect(ok.status).toBe(200);
        expect(await reserved(payment._id)).toBe(0);
      } finally {
        refundSpy.mockRestore();
        lookupSpy.mockRestore();
      }
    });
  });
});

describe("interrupted refunds (the API stopped mid-call)", () => {
  async function interruptedClaim(amount: number, amountReserved: boolean) {
    const { order, payment } = await paidPayment(40);
    if (amountReserved) await Payment.updateOne({ _id: payment._id }, { $inc: { totalRefunded: amount } });
    const claim = await Refund.create({
      restaurantId: restaurantA._id,
      paymentId: payment._id,
      orderId: payment.orderId,
      provider: "mock",
      amount,
      status: "pending",
      idempotencyKey: `interrupted-${payment.id}`,
      providerRefundKey: providerRefundIdempotencyKey(restaurantA.id, `interrupted-${payment.id}`),
      initiatedByUserId: ownerAId,
      ...(amountReserved ? { amountReserved: true } : {}),
    });
    await backdate(claim._id, Math.max(STALE_REFUND_CLAIM_MS, MANUAL_NOT_REFUNDED_MIN_HOLD_MS) + 60_000);
    return { order, payment, claim };
  }

  it("a stale claim is treated as held — shown, and checkable", async () => {
    const { order, payment, claim } = await interruptedClaim(15, true);
    const list = await get(`${base(order.id, payment.id)}/refunds`, ownerAToken);
    expect(list.body.data.refunds[0].reconciliation.held).toBe(true);
    const check = await post(`${base(order.id, payment.id)}/refunds/${claim.id}/check`, ownerAToken);
    expect(check.body.data.outcome).toBe("not_found");
  });

  it("releasing a claim that never reserved gives nothing back (can't free another refund's reservation)", async () => {
    const { order, payment, claim } = await interruptedClaim(15, false);
    await Payment.updateOne({ _id: payment._id }, { $set: { totalRefunded: 10 } }); // some other reservation
    // Never re-issued without a recorded reservation.
    const refundSpy = jest.spyOn(mock, "refund");
    const retry = await post(`${base(order.id, payment.id)}/refunds/${claim.id}/retry`, ownerAToken);
    expect(retry.body.data.outcome).toBe("not_found");
    expect(refundSpy).not.toHaveBeenCalled();
    refundSpy.mockRestore();
    const ok = await post(`${base(order.id, payment.id)}/refunds/${claim.id}/resolve`, ownerAToken, { outcome: "not_refunded", evidence: "Not in the dashboard", confirmChecked: true });
    expect(ok.status).toBe(200);
    expect(await reserved(payment._id)).toBe(10);
  });

  it("confirming a claim that never reserved as refunded counts it now", async () => {
    const { order, payment, claim } = await interruptedClaim(15, false);
    const ok = await post(`${base(order.id, payment.id)}/refunds/${claim.id}/resolve`, ownerAToken, { outcome: "refunded", providerRefundRef: "re_late_1", evidence: "Found in dashboard" });
    expect(ok.status).toBe(200);
    expect(await reserved(payment._id)).toBe(15);
  });
});
