import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { getBillingProvider } from "../billing/index.js";
import type { ProviderBillingWebhookEvent } from "../billing/BillingProvider.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { cancelSubscription, changeSubscriptionPlan, processBillingProviderEvent } from "./subscription.service.js";
import { recordBillingHistoryEvent } from "./billingHistory.service.js";
import { closeTestConnections, createTestPlan, createTestSubscription } from "../test-utils/fixtures.js";

/**
 * Phase 89 — the live-readiness fixes for real Paddle billing, driven through the real service:
 *  P1 a plan change sends the provider PRICE id for the subscription's interval, never a plan code;
 *  P2 transaction/adjustment events never move a subscription's status;
 *  P3 renewals move the billing period, a scheduled cancel stays "cancelling", stale events can't
 *     roll details back, and a plan changed at the provider is reflected locally;
 *  refunds/chargebacks are recorded in billing history only.
 */
const ownerIds: mongoose.Types.ObjectId[] = [];
const planIds: mongoose.Types.ObjectId[] = [];
let starter: Awaited<ReturnType<typeof createTestPlan>>;
let growth: Awaited<ReturnType<typeof createTestPlan>>;
let unpriced: Awaited<ReturnType<typeof createTestPlan>>;
let seq = 0;

beforeAll(async () => {
  await connectDB();
  await BillingHistoryEvent.createIndexes(); // the unique notice index the duplicate tests rely on
  const suffix = new mongoose.Types.ObjectId().toString();
  starter = await createTestPlan({
    pricing: [
      { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: `pri_starter_m_${suffix}` },
      { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: `pri_starter_y_${suffix}` },
    ],
  });
  growth = await createTestPlan({
    pricing: [
      { interval: "monthly", amountCents: 9900, currency: "USD", providerPriceId: `pri_growth_m_${suffix}` },
      { interval: "yearly", amountCents: 99000, currency: "USD", providerPriceId: `pri_growth_y_${suffix}` },
    ],
  });
  unpriced = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 1000, currency: "USD" }] });
  planIds.push(starter._id, growth._id, unpriced._id);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([
    Subscription.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingHistoryEvent.deleteMany({ ownerId: { $in: ownerIds } }),
    BillingWebhookEvent.deleteMany({ eventId: /^evt_p89_/ }),
    Plan.deleteMany({ _id: { $in: planIds } }),
  ]);
  await closeTestConnections();
});

async function paddleSubscription(overrides: Record<string, unknown> = {}) {
  const ownerId = new mongoose.Types.ObjectId();
  ownerIds.push(ownerId);
  const providerSubscriptionId = `sub_p89_${ownerId.toString()}`;
  const subscription = await createTestSubscription("business", ownerId, starter._id, {
    provider: "paddle",
    providerSubscriptionId,
    currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
    currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
    ...overrides,
  });
  return { ownerId, subscription, providerSubscriptionId };
}

function event(providerSubscriptionId: string, fields: Partial<ProviderBillingWebhookEvent>): ProviderBillingWebhookEvent {
  seq += 1;
  return { eventId: `evt_p89_${Date.now()}_${seq}`, eventType: "subscription.updated", providerSubscriptionId, raw: {}, ...fields };
}

const history = (ownerId: mongoose.Types.ObjectId) => BillingHistoryEvent.find({ ownerId }).sort({ createdAt: 1 }).lean();

describe("P1 — plan change sends the provider price id", () => {
  it("sends the new plan's price id for the subscription's own billing interval", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription({ provider: "mock", billingInterval: "yearly" });
    const spy = jest.spyOn(getBillingProvider(), "changePlan").mockResolvedValue({} as never);
    const updated = await changeSubscriptionPlan(ownerId.toString(), growth.code);
    expect(spy).toHaveBeenCalledWith(providerSubscriptionId, growth.pricing.find((p) => p.interval === "yearly")!.providerPriceId);
    expect(updated.planId.toString()).toBe(growth._id.toString());
  });

  it("refuses a plan with no provider price for that interval, without calling the provider", async () => {
    const { ownerId } = await paddleSubscription({ provider: "mock" });
    const spy = jest.spyOn(getBillingProvider(), "changePlan").mockResolvedValue({} as never);
    await expect(changeSubscriptionPlan(ownerId.toString(), unpriced.code)).rejects.toThrow(/no monthly price configured/);
    expect(spy).not.toHaveBeenCalled();
    expect((await Subscription.findOne({ ownerId }))!.planId.toString()).toBe(starter._id.toString());
  });
});

describe("P2 — transaction and adjustment events never move status", () => {
  it("a renewal payment keeps an active subscription active and records the payment once", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const notice = { type: "payment_succeeded" as const, amountCents: 5900, currency: "USD", reference: "txn_renewal_1" };
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { eventType: "transaction.completed", billingNotice: notice }));
    // Same transaction reported again under a different event id: still one row.
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { eventType: "transaction.completed", billingNotice: notice }));

    expect((await Subscription.findOne({ ownerId }))!.status).toBe("active");
    const rows = await history(ownerId);
    expect(rows.map((r) => r.type)).toEqual(["payment_succeeded"]);
    expect(rows[0]).toMatchObject({ amountCents: 5900, currency: "USD", providerReference: "txn_renewal_1" });
  });

  it("a transaction event with no notice changes nothing and is marked processed", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const e = event(providerSubscriptionId, { eventType: "transaction.payment_failed" });
    await processBillingProviderEvent("paddle", e);
    expect((await Subscription.findOne({ ownerId }))!.status).toBe("active");
    expect(await history(ownerId)).toHaveLength(0);
    expect((await BillingWebhookEvent.findOne({ eventId: e.eventId }))!.processedAt).toBeInstanceOf(Date);
  });
});

describe("Refunds and chargebacks are recorded, never acted on", () => {
  it("records refund, chargeback and reversal rows and leaves status and access alone", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    for (const type of ["refunded", "chargeback", "chargeback_reversed"] as const) {
      await processBillingProviderEvent(
        "paddle",
        event(providerSubscriptionId, { eventType: "adjustment.updated", billingNotice: { type, amountCents: 5900, currency: "USD", reference: `adj_${type}` } })
      );
    }
    expect((await Subscription.findOne({ ownerId }))!.status).toBe("active");
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["refunded", "chargeback", "chargeback_reversed"]);
  });
});

describe("P3 — renewals, scheduled cancellation, ordering, outside plan changes", () => {
  it("a renewal moves the billing period forward", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, {
        status: "active",
        occurredAt: new Date("2026-11-01T00:00:05Z"),
        currentPeriod: { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") },
        scheduledCancelAt: null,
      })
    );
    const sub = await Subscription.findOne({ ownerId });
    expect(sub!.currentPeriodStart).toEqual(new Date("2026-11-01T00:00:00Z"));
    expect(sub!.currentPeriodEnd).toEqual(new Date("2026-12-01T00:00:00Z"));
    expect(sub!.status).toBe("active");
  });

  it("an older event arriving late does not roll the period back", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const newer = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-11-01T00:00:05Z"), currentPeriod: newer }));
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, {
        status: "active",
        occurredAt: new Date("2026-10-01T00:00:05Z"),
        currentPeriod: { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") },
      })
    );
    expect((await Subscription.findOne({ ownerId }))!.currentPeriodEnd).toEqual(newer.end);
  });

  it("'active' with a scheduled cancel means cancelling — and a later 'nothing scheduled' reactivates", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const endsAt = new Date("2026-11-01T00:00:00Z");
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-10T00:00:00Z"), scheduledCancelAt: endsAt }));
    let sub = await Subscription.findOne({ ownerId });
    expect(sub!.status).toBe("cancelling");
    expect(sub!.cancelAt).toEqual(endsAt);

    // A repeat of the same state (e.g. an unrelated update while still scheduled) must NOT reactivate.
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-11T00:00:00Z"), scheduledCancelAt: endsAt }));
    expect((await Subscription.findOne({ ownerId }))!.status).toBe("cancelling");

    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-12T00:00:00Z"), scheduledCancelAt: null }));
    sub = await Subscription.findOne({ ownerId });
    expect(sub!.status).toBe("active");
    expect(sub!.cancelAt).toBeUndefined();
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["cancellation_requested", "reactivated"]);
  });

  it("a price change made at the provider moves the local plan and interval", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const growthYearly = growth.pricing.find((p) => p.interval === "yearly")!;
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", providerPriceId: growthYearly.providerPriceId! }));
    const sub = await Subscription.findOne({ ownerId });
    expect(sub!.planId.toString()).toBe(growth._id.toString());
    expect(sub!.billingInterval).toBe("yearly");
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["plan_changed"]);
  });

  it("an unknown provider price leaves the plan unchanged", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", providerPriceId: "pri_not_in_catalog" }));
    expect((await Subscription.findOne({ ownerId }))!.planId.toString()).toBe(starter._id.toString());
  });
});

// Phase 89 follow-up — the review's ordering and duplicate findings, each as the exact scenario.
describe("Event ordering — only subscription events order subscription state", () => {
  const renewal = { start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") };

  it("a renewal payment processed BEFORE the matching subscription update (with a later occurred_at) does not cause the new dates to be skipped", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription({ lastProviderEventAt: new Date("2026-10-01T00:00:00Z") });
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, {
        eventType: "transaction.completed",
        occurredAt: new Date("2026-11-01T00:00:09Z"),
        billingNotice: { type: "payment_succeeded", amountCents: 5900, currency: "USD", reference: "txn_order_1" },
      })
    );
    // The payment event never touches the subscription's ordering timestamp…
    expect((await Subscription.findOne({ ownerId }))!.lastProviderEventAt).toEqual(new Date("2026-10-01T00:00:00Z"));

    // …so the subscription update that happened a few seconds EARLIER still applies its new period.
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-11-01T00:00:03Z"), currentPeriod: renewal, scheduledCancelAt: null })
    );
    const sub = await Subscription.findOne({ ownerId });
    expect(sub!.currentPeriodEnd).toEqual(renewal.end);
    expect(sub!.lastProviderEventAt).toEqual(new Date("2026-11-01T00:00:03Z"));
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["payment_succeeded"]);
  });

  it("an OLDER 'active, nothing scheduled' event arriving after a newer scheduled-cancel event does not reactivate", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const endsAt = new Date("2026-11-01T00:00:00Z");
    await processBillingProviderEvent("paddle", event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-20T00:00:00Z"), scheduledCancelAt: endsAt }));
    const stale = event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-15T00:00:00Z"), scheduledCancelAt: null });
    await processBillingProviderEvent("paddle", stale);

    const sub = await Subscription.findOne({ ownerId });
    expect(sub!.status).toBe("cancelling");
    expect(sub!.cancelAt).toEqual(endsAt);
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["cancellation_requested"]);
    const record = await BillingWebhookEvent.findOne({ eventId: stale.eventId });
    expect(record!.processedAt).toBeInstanceOf(Date);
    expect(record!.processingError).toMatch(/older than the subscription state/);
  });

  it("an OLDER event carrying the previous price does not undo a newer plan change, nor its billing period", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const growthMonthly = growth.pricing.find((p) => p.interval === "monthly")!.providerPriceId!;
    const starterMonthly = starter.pricing.find((p) => p.interval === "monthly")!.providerPriceId!;
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-20T00:00:00Z"), providerPriceId: growthMonthly, currentPeriod: renewal })
    );
    await processBillingProviderEvent(
      "paddle",
      event(providerSubscriptionId, {
        status: "active",
        occurredAt: new Date("2026-10-10T00:00:00Z"),
        providerPriceId: starterMonthly,
        currentPeriod: { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") },
      })
    );
    const sub = await Subscription.findOne({ ownerId });
    expect(sub!.planId.toString()).toBe(growth._id.toString());
    expect(sub!.currentPeriodEnd).toEqual(renewal.end);
    expect((await history(ownerId)).map((r) => r.type)).toEqual(["plan_changed"]);
  });

  it("an event that happened before an in-app cancellation (delivered late) does not undo it", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription({ provider: "mock" });
    jest.spyOn(getBillingProvider(), "cancelSubscription").mockResolvedValue({} as never);
    const before = new Date(Date.now() - 60_000);
    await cancelSubscription(ownerId.toString());
    expect((await Subscription.findOne({ ownerId }))!.status).toBe("cancelling");

    await processBillingProviderEvent("mock", event(providerSubscriptionId, { status: "active", occurredAt: before, scheduledCancelAt: null }));
    expect((await Subscription.findOne({ ownerId }))!.status).toBe("cancelling");
  });

  it("a newer and an older subscription event racing each other always end on the newer state", async () => {
    for (let round = 0; round < 4; round++) {
      const { ownerId, providerSubscriptionId } = await paddleSubscription();
      const endsAt = new Date("2026-11-01T00:00:00Z");
      const newer = event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-20T00:00:00Z"), scheduledCancelAt: endsAt });
      // (The older one would reactivate if it were applied last.)
      const older = event(providerSubscriptionId, { status: "active", occurredAt: new Date("2026-10-10T00:00:00Z"), scheduledCancelAt: null });
      const pair = round % 2 ? [older, newer] : [newer, older];
      await Promise.all(pair.map((e) => processBillingProviderEvent("paddle", e)));
      const sub = await Subscription.findOne({ ownerId });
      expect(sub!.status).toBe("cancelling");
      expect(sub!.lastProviderEventAt).toEqual(new Date("2026-10-20T00:00:00Z"));
    }
  }, 30_000);
});

describe("Refund/chargeback notices are recorded once, even under concurrent delivery", () => {
  it("concurrent deliveries of the same refund (adjustment.created + adjustment.updated) record one row", async () => {
    const { ownerId, providerSubscriptionId } = await paddleSubscription();
    const refund = { type: "refunded" as const, amountCents: 5900, currency: "USD", reference: "adj_race_1" };
    await Promise.all([
      processBillingProviderEvent("paddle", event(providerSubscriptionId, { eventType: "adjustment.created", billingNotice: refund })),
      processBillingProviderEvent("paddle", event(providerSubscriptionId, { eventType: "adjustment.updated", billingNotice: refund })),
      processBillingProviderEvent("paddle", event(providerSubscriptionId, { eventType: "adjustment.updated", billingNotice: refund })),
    ]);
    expect((await history(ownerId)).filter((r) => r.type === "refunded")).toHaveLength(1);
  });

  it("the database refuses a second row with the same notice key, and the recorder treats that as already recorded", async () => {
    const { ownerId, subscription } = await paddleSubscription();
    const row = {
      ownerType: "business" as const,
      ownerId,
      subscriptionId: subscription._id,
      type: "chargeback" as const,
      provider: "paddle" as const,
      noticeKey: "chargeback:adj_db_1",
    };
    await Promise.all([recordBillingHistoryEvent(row), recordBillingHistoryEvent(row), recordBillingHistoryEvent(row)]);
    expect(await BillingHistoryEvent.countDocuments({ ownerId, noticeKey: "chargeback:adj_db_1" })).toBe(1);
    // Rows without a notice key are unaffected by the index.
    await recordBillingHistoryEvent({ ...row, noticeKey: undefined, type: "plan_changed" });
    await recordBillingHistoryEvent({ ...row, noticeKey: undefined, type: "plan_changed" });
    expect(await BillingHistoryEvent.countDocuments({ ownerId, type: "plan_changed" })).toBe(2);
  });
});
