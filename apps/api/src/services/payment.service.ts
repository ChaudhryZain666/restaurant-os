import { createHash } from "node:crypto";
import mongoose, { type HydratedDocument } from "mongoose";
import { Order, type OrderDoc } from "../models/Order.js";
import { Payment, type PaymentDoc } from "../models/Payment.js";
import { Refund, type RefundDoc } from "../models/Refund.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { getPaymentProvider, type PaymentProviderName } from "../payments/index.js";
import { resolveEligiblePaymentProvider } from "../payments/eligibility.js";
import { buildProviderFromAccount, canProcessOnlinePayments, resolveRestaurantPaymentProvider } from "../payments/restaurantProvider.js";
import { RestaurantPaymentAccount } from "../models/RestaurantPaymentAccount.js";
import type { LocalRefundStatus, PaymentProvider, ProviderRefundResult, ProviderRefundUpdate, ProviderWebhookEvent } from "../payments/PaymentProvider.js";
import { ProviderRequestError } from "../payments/PaymentProvider.js";
import { isValidPaymentTransition } from "./paymentStateMachine.js";
import { emitOrderEvent } from "../events/orderEvents.js";
import { reverseLoyaltyForOrderIfNeeded } from "./loyalty.service.js";
import { env } from "../config/env.js";
import { recordAuditEvent } from "./audit.service.js";

interface CreatePaymentInput {
  restaurantId: string;
  orderId: string;
  customerId: string;
  idempotencyKey: string;
}

/**
 * Creates (or, for a retried/double-clicked request, reuses) a payment attempt for an order.
 * The amount is always the server-stored Order.total — nothing about how much this payment is
 * for ever comes from the request.
 */
export async function createPaymentForOrder(
  input: CreatePaymentInput
): Promise<{ payment: HydratedDocument<PaymentDoc>; clientSecret?: string; created: boolean }> {
  const { restaurantId, orderId, customerId, idempotencyKey } = input;

  // Idempotency: a payment already created under this exact key is returned as-is, never
  // recreated — the DB-level unique index on {restaurantId, idempotencyKey} is the real
  // guarantee; this lookup just avoids a wasted provider call and a guaranteed duplicate-key
  // error on the common path.
  const existingByKey = await Payment.findOne({ restaurantId, idempotencyKey });
  if (existingByKey) return { payment: existingByKey, created: false };

  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.customerId.toString() !== customerId) throw ApiError.forbidden();
  if (order.paymentMethod !== "online") {
    throw ApiError.badRequest(`This order was placed with paymentMethod "${order.paymentMethod}" and has no online payment to create.`);
  }
  if (order.paymentStatus === "paid") throw ApiError.conflict("This order is already paid");

  // Reuse an existing non-terminal attempt rather than spawning a new provider intent every time
  // the customer reloads the checkout/payment page — "one order may have multiple payment
  // attempts" covers genuine retries after a failure, not a fresh intent per page view.
  const reusable = await Payment.findOne({
    restaurantId,
    orderId,
    status: { $in: ["pending", "requires_action", "authorized"] },
  }).sort({ createdAt: -1 });
  if (reusable) return { payment: reusable, created: false };

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  // A suspended restaurant must not keep receiving new money while invisible to customers —
  // createOrder already blocks NEW orders for a suspended restaurant, but an order placed while
  // still active (and not yet paid) could otherwise still be paid for afterward. Refunds are
  // deliberately NOT blocked here — a suspended restaurant's customers should still be able to get
  // their money back.
  if (restaurant.status === "suspended") {
    throw ApiError.badRequest("This restaurant is temporarily unable to accept payments — please contact the restaurant.");
  }

  // BYOC (restaurant-owned payment account, restaurantProvider.ts) is checked FIRST,
  // unconditionally — a restaurant that connected its own account is a stronger, more explicit
  // signal than country-based pooled routing, and this deliberately lets a restaurant in an
  // otherwise-country-ineligible market accept online payments by connecting its own account
  // directly (it's vouching for that account itself). Only when a restaurant has no active BYOC
  // account does resolution fall through to the exact existing pooled/eligibility logic, unchanged.
  let provider = getPaymentProvider();
  let restaurantPaymentAccountId: string | undefined;
  const own = await resolveRestaurantPaymentProvider(restaurantId);
  if (own) {
    provider = own.provider;
    restaurantPaymentAccountId = own.accountId;
  } else if (env.PAYMENT_ELIGIBILITY_ROUTING) {
    // Phase 34 — country/currency eligibility routing is opt-in (env.PAYMENT_ELIGIBILITY_ROUTING,
    // default false): every existing deployment/test/dev environment keeps today's exact behavior
    // (the single PAYMENT_PROVIDER-configured default, regardless of restaurant country) unless a
    // deployment deliberately turns this on. When enabled, a restaurant whose country has no
    // eligible configured provider gets a clear error rather than silently falling back to a
    // provider that doesn't actually serve that market — see payments/eligibility.ts.
    const eligible = resolveEligiblePaymentProvider(restaurant);
    if (!eligible) {
      throw ApiError.badRequest("Online payment isn't available for this restaurant's country yet — please pay with cash.");
    }
    provider = getPaymentProvider(eligible.providerName);
  }

  // Phase 42 — production safety gate: a restaurant with no connected payment account of its own
  // must never have a real online payment processed through the platform's pooled credentials.
  // The mock provider is exempt (dev/test/demo default, never real money), so this is a no-op for
  // every existing environment that hasn't configured a real platform-wide provider.
  if (!canProcessOnlinePayments(Boolean(restaurantPaymentAccountId), provider.name, env.NODE_ENV)) {
    throw ApiError.badRequest("This restaurant hasn't connected a payment account yet — please pay with cash.");
  }

  // Same order-detail page the customer already lands on after checkout (CartPage.tsx) — a real
  // provider's hosted checkout sends them right back to it, success or cancel alike, where the
  // existing "Unpaid"/"Paid" panel state (driven by the webhook-confirmed order, not this redirect)
  // takes over. The mock provider never reads these at all.
  const returnUrl = `${env.CLIENT_ORIGIN}/orders/${order.id}`;
  const intent = await provider.createIntent({
    amount: order.total,
    currency: restaurant.settings.currency,
    orderId: order.id,
    restaurantId,
    metadata: { orderNumber: order.orderNumber },
    returnUrl,
    cancelUrl: returnUrl,
  });

  try {
    const payment = await Payment.create({
      restaurantId,
      orderId,
      customerId,
      method: "online",
      provider: provider.name,
      providerRef: intent.providerRef,
      restaurantPaymentAccountId,
      currency: restaurant.settings.currency,
      amount: order.total,
      status: intent.status,
      idempotencyKey,
    });
    return { payment, clientSecret: intent.clientSecret, created: true };
  } catch (err) {
    // A duplicate-key error here means a concurrent request with the same idempotency key won
    // the race — fetch and return what it created instead of surfacing a 500 to the loser.
    if ((err as { code?: number }).code === 11000) {
      const winner = await Payment.findOne({ restaurantId, idempotencyKey });
      if (winner) return { payment: winner, created: false };
    }
    throw err;
  }
}

export async function listPaymentsForOrder(restaurantId: string, orderId: string): Promise<HydratedDocument<PaymentDoc>[]> {
  return Payment.find({ restaurantId, orderId }).sort({ createdAt: -1 });
}

export async function getPaymentById(restaurantId: string, paymentId: string): Promise<HydratedDocument<PaymentDoc>> {
  const payment = await Payment.findOne({ _id: paymentId, restaurantId });
  if (!payment) throw ApiError.notFound("Payment not found");
  return payment;
}

/**
 * The single entry point every inbound webhook (real or mock-simulated) goes through. Idempotent
 * by construction: the insert into PaymentWebhookEvent is the source of truth for "have we seen
 * this event before," not an in-application check, so it's race-safe against the same event
 * arriving twice concurrently.
 *
 * `restaurantPaymentAccountId` is optional and only ever passed by the BYOC webhook route
 * (handleRestaurantAccountWebhook) — defense-in-depth against a cross-tenant `providerRef`
 * collision, not load-bearing (Stripe/Safepay identifiers are globally unique in practice). The
 * pooled webhook path (handleProviderWebhook) never passes it, so its lookup is unchanged.
 */
export async function processProviderEvent(
  providerName: string,
  event: ProviderWebhookEvent,
  restaurantPaymentAccountId?: string
): Promise<void> {
  try {
    await PaymentWebhookEvent.create({
      provider: providerName,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.raw,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info("duplicate payment webhook event ignored", { provider: providerName, eventId: event.eventId });
      return;
    }
    throw err;
  }

  // A refund event goes to the refund state machine, never the payment one.
  if (event.refund) {
    await applyProviderRefundUpdate(providerName, event.refund, restaurantPaymentAccountId);
    await PaymentWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
    return;
  }

  const payment = await Payment.findOne({
    provider: providerName,
    providerRef: event.providerRef,
    ...(restaurantPaymentAccountId ? { restaurantPaymentAccountId } : {}),
  });
  if (!payment) {
    logger.warn("payment webhook event for unknown payment reference", {
      provider: providerName,
      providerRef: event.providerRef,
    });
    await PaymentWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: "No matching payment for providerRef" } }
    );
    return;
  }

  if (!isValidPaymentTransition(payment.status, event.status)) {
    logger.warn("ignored invalid payment status transition from webhook", {
      paymentId: payment.id,
      from: payment.status,
      to: event.status,
    });
    await PaymentWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processedAt: new Date(), processingError: `Ignored: ${payment.status} -> ${event.status}` } }
    );
    return;
  }

  await applyPaymentStatusTransition(payment, event.status);

  await PaymentWebhookEvent.updateOne(
    { provider: providerName, eventId: event.eventId },
    { $set: { processedAt: new Date() } }
  );
}

/**
 * The actual state-transition writer, extracted (Phase 35 audit fix) so both a real webhook
 * delivery (processProviderEvent above) and the polling reconciliation fallback
 * (reconcileStalePayments below) apply a status change through the exact same atomic path,
 * instead of that logic existing only inline inside the webhook handler. Callers are responsible
 * for their own idempotency/validity gating first (webhook: PaymentWebhookEvent insert +
 * isValidPaymentTransition; reconciliation: its own isValidPaymentTransition check) — this
 * function only ever applies a single, already-decided transition.
 */
/**
 * Exported (Phase 74) — posTerminalPayment.service.ts reuses this exact atomic transition path
 * (the partial-unique-index-backed "one paid Payment per order" guarantee, the transactional
 * Order.paymentStatus write, the order.payment_updated event) for POS terminal payments too,
 * rather than a second, parallel implementation. This function only ever applies a single,
 * already-decided transition — callers own their own idempotency/validity gating first.
 */
export async function applyPaymentStatusTransition(
  payment: HydratedDocument<PaymentDoc>,
  newStatus: ProviderWebhookEvent["status"]
): Promise<void> {
  const session = await mongoose.startSession();
  try {
    // Untyped, not `OrderDoc | null`: TypeScript can't carry a useful narrowed type for a `let`
    // only ever assigned inside an async closure passed to withTransaction (same limitation
    // order.controller.ts's createOrder already works around the same way) — cast at the one
    // usage site below instead of fighting the checker here.
    let orderAfter;
    await session.withTransaction(async () => {
      // Guarded by status: {$ne: to} so a race between two deliveries/checks of the same
      // real-world transition can't apply it twice — combined with Payment's partial unique index
      // on {orderId: unique where status:"paid"}, this makes double-marking-paid effectively
      // impossible even under concurrent webhook delivery or a reconciliation-vs-webhook race.
      const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $ne: newStatus } },
        { $set: { status: newStatus } },
        { new: true, session }
      );
      if (!updated) return; // lost the race to an identical concurrent update — nothing left to do

      if (newStatus === "paid") {
        orderAfter = await Order.findOneAndUpdate(
          { _id: payment.orderId, restaurantId: payment.restaurantId },
          { $set: { paymentStatus: "paid" } },
          { new: true, session }
        );
      } else if (newStatus === "failed" || newStatus === "cancelled") {
        orderAfter = await Order.findOne({ _id: payment.orderId, restaurantId: payment.restaurantId }).session(session);
      }
    });

    const order = orderAfter as unknown as HydratedDocument<OrderDoc> | null;
    if (order) {
      emitOrderEvent("order.payment_updated", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId.toString(),
        customerId: order.customerId.toString(),
        status: order.status,
        paymentOutcome: newStatus,
      });
    }
  } finally {
    await session.endSession();
  }
}

const RECONCILIATION_STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Phase 35 audit fix — LAUNCH BLOCKER closed: this codebase's entire "a payment succeeded" signal
 * previously depended 100% on a webhook actually arriving (provider.retrieve() was called only
 * from test files, never from any controller/service/job). If a restaurant's webhook was never
 * configured, misconfigured, or a delivery was dropped, a customer could pay real money and the
 * Payment/Order would sit "pending" forever with no error raised anywhere — silent to the
 * platform, the restaurant, AND the customer. This is a bounded polling fallback, not a
 * replacement for webhooks (which stay the fast path): runs on a repeatable job
 * (registerPaymentReconciliationJob, notification.queue.ts), finds every online payment still
 * pending/requires_action after RECONCILIATION_STALE_AFTER_MS, resolves the SAME provider
 * credentials the original attempt used (pooled by provider name, or the exact BYOC account —
 * never today's current default, which could differ), and calls the provider's own retrieve() to
 * check the real current status. A mismatch is applied through the identical atomic transition
 * path a webhook uses. One payment's reconciliation failing (provider timeout, deleted BYOC
 * account, etc.) is logged and never blocks the rest of the sweep.
 */
// Phase 49 — a defensive cap, not a business rule: under healthy operation the number of payments
// still pending/requires_action past the stale threshold should be near zero (this ticks every 10
// minutes — see registerPaymentReconciliationJob). Bounding it means a pathological spike (an
// outage, a bug that stops payments from ever resolving) can't turn one job tick into thousands of
// synchronous provider .retrieve() calls — any excess stays "stale" and is simply picked up by the
// next tick, so this changes worst-case behavior only, never a normal run's outcome.
const RECONCILIATION_BATCH_LIMIT = 500;

export async function reconcileStalePayments(): Promise<void> {
  const staleBefore = new Date(Date.now() - RECONCILIATION_STALE_AFTER_MS);
  const stale = await Payment.find({
    status: { $in: ["pending", "requires_action"] },
    method: "online",
    providerRef: { $type: "string" },
    createdAt: { $lt: staleBefore },
  }).limit(RECONCILIATION_BATCH_LIMIT);

  for (const payment of stale) {
    try {
      let provider;
      if (payment.restaurantPaymentAccountId) {
        const account = await RestaurantPaymentAccount.findById(payment.restaurantPaymentAccountId);
        if (!account) {
          logger.warn("reconciliation skipped — restaurant payment account no longer exists", {
            paymentId: payment.id,
            restaurantPaymentAccountId: payment.restaurantPaymentAccountId,
          });
          continue;
        }
        provider = buildProviderFromAccount(account);
      } else {
        provider = getPaymentProvider(payment.provider as PaymentProviderName);
      }

      const snapshot = await provider.retrieve(payment.providerRef!);
      if (snapshot.status === payment.status) continue;
      if (!isValidPaymentTransition(payment.status, snapshot.status)) continue;

      await applyPaymentStatusTransition(payment, snapshot.status);
      logger.info("payment reconciled via polling fallback — a webhook likely never arrived", {
        paymentId: payment.id,
        from: payment.status,
        to: snapshot.status,
      });
    } catch (err) {
      logger.error("payment reconciliation check failed", { paymentId: payment.id, error: (err as Error).message });
    }
  }
}

interface RefundInput {
  restaurantId: string;
  paymentId: string;
  amount?: number;
  reason?: string;
  initiatedByUserId: string;
  idempotencyKey: string;
}

function roundCurrency(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Refunds must never let two concurrent requests both succeed against overlapping "remaining
 * balance" — that used to be a genuine race (read succeeded-refunds sum, check, THEN call the
 * provider and write) where two simultaneous refund attempts on the same payment could both read
 * the same remaining balance before either had recorded its result, together refunding more than
 * the original payment.
 *
 * Fixed via reserve-then-call, NOT via a Mongo transaction wrapping the provider call: this
 * codebase's other atomicity fixes (createOrder, webhook processing) wrap only internal DB writes
 * in transactions, and `session.withTransaction` retries its whole callback on a write conflict —
 * retrying a call to a REAL payment provider would risk double-refunding real money. Instead,
 * `Payment.totalRefunded` is atomically incremented with a filter that re-checks the remaining
 * balance at write time (the actual guard), reserving the amount BEFORE the external call. The
 * reservation is released ONLY when the refund is known not to have happened: the provider
 * definitively refused the request, or reported/confirmed it failed or canceled. A refund that is
 * pending at the provider (incl. Stripe requires_action) or whose outcome is unknown keeps it, so the
 * system can under-refund while a refund waits, but never over-refund.
 *
 * Idempotency is claimed FIRST (CI run #12 investigation): the refund document is created as
 * "pending" before any money moves, so the unique {restaurantId, idempotencyKey} index admits exactly
 * one request per key. A concurrent duplicate with the same key gets the winner's refund back and
 * never reserves or calls the provider — previously both could pass the read-only key check, both
 * reserve, and both call the provider (two real refunds; the unique index only stopped the second
 * record afterwards). A claim whose reservation is refused, or whose provider call is definitively
 * refused, is removed again so the same key can retry.
 *
 * Unknown outcomes (timeout, dropped connection, provider 5xx, or the API dying mid-call) HOLD the
 * refund — see reconcileRefund (provider lookup; re-issue with the same provider key only when the
 * provider definitively has no such refund and still honors the key) and resolveHeldRefund (a person,
 * with evidence). A held or provider-pending refund blocks further refunds on that payment (409).
 *
 * Status contract (pinned by payment.controller.test.ts): 400 when the amount exceeds what is known
 * to be left when the request reads the payment (including a refund that completed or reserved just
 * before); 409 when this request passed that check but lost the atomic reservation to a concurrent
 * refund, or while another refund on the payment is waiting/held. Either way at most one of them
 * moves money.
 */
export async function refundPayment(input: RefundInput): Promise<HydratedDocument<RefundDoc>> {
  const { restaurantId, paymentId, reason, initiatedByUserId, idempotencyKey } = input;

  // Another request with this key may have claimed it at any point after our first look, so every
  // refusal below re-checks the key first: a same-key duplicate always gets that request's refund
  // (the idempotency contract), never an error caused by the refund it duplicates.
  const sameKeyRefund = async (): Promise<HydratedDocument<RefundDoc> | null> => {
    const existing = await Refund.findOne({ restaurantId, idempotencyKey });
    if (!existing) return null;
    // A same-key retry of a held refund reconciles it against the provider's records FIRST — it is
    // only ever re-issued when the provider definitively has no such refund and still honors the key.
    if (isHeld(existing)) {
      return (await reconcileRefund(existing, { actorUserId: initiatedByUserId, actorRole: "staff", allowReissue: true })).refund;
    }
    return existing;
  };

  const existingByKey = await sameKeyRefund();
  if (existingByKey) return existingByKey;

  const payment = await Payment.findOne({ _id: paymentId, restaurantId });
  if (!payment) throw ApiError.notFound("Payment not found");
  if (payment.status !== "paid" && payment.status !== "partially_refunded") {
    const duplicate = await sameKeyRefund(); // e.g. the same-key request just refunded it in full
    if (duplicate) return duplicate;
    throw ApiError.badRequest(`Cannot refund a payment with status "${payment.status}"`);
  }

  // A refund on this payment that is still waiting (held, or pending at the provider) blocks new
  // ones with a message that says so — not a confusing "amount must be between…" from the reservation.
  const waiting = await Refund.findOne({ paymentId: payment._id, status: "pending" }).sort({ createdAt: 1 });
  if (waiting) {
    // The waiting refund may be the same-key request's own claim, created after our first look —
    // that request's refund is this one's answer, not a conflict (CI flake on PR #10).
    if (waiting.idempotencyKey === idempotencyKey) return (await sameKeyRefund()) ?? waiting;
    const duplicate = await sameKeyRefund();
    if (duplicate) return duplicate;
    throw ApiError.conflict(
      isHeld(waiting) || waiting.providerRefundRef
        ? `A refund of ${waiting.amount} on this payment is waiting to be confirmed by ${waiting.provider}. Resolve it first (order → Payment → Refunds).`
        : "Another refund for this payment is being processed right now. Try again in a moment."
    );
  }

  const remaining = roundCurrency(payment.amount - payment.totalRefunded);
  const amount = input.amount ?? remaining;
  if (amount <= 0 || amount > remaining) {
    const duplicate = await sameKeyRefund(); // its amount may be what's now used up
    if (duplicate) return duplicate;
    throw ApiError.badRequest(`Refund amount must be between 0 and ${remaining} (already refunded: ${payment.totalRefunded})`);
  }

  // Resolved before anything is claimed or reserved, so a missing account changes nothing.
  const provider = await refundProviderFor(payment);

  // Claim the idempotency key before anything else (see the doc comment above).
  let claim: HydratedDocument<RefundDoc>;
  try {
    claim = await Refund.create({
      restaurantId,
      paymentId: payment._id,
      orderId: payment.orderId,
      provider: provider.name,
      amount,
      reason,
      status: "pending",
      idempotencyKey,
      providerRefundKey: providerRefundIdempotencyKey(restaurantId, idempotencyKey),
      initiatedByUserId,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const winner = await Refund.findOne({ restaurantId, idempotencyKey });
      if (winner) return winner;
    }
    throw err;
  }

  const reserved = await Payment.findOneAndUpdate(
    {
      _id: payment._id,
      status: { $in: ["paid", "partially_refunded"] },
      $expr: { $lte: [{ $add: ["$totalRefunded", amount] }, "$amount"] },
    },
    { $inc: { totalRefunded: amount } },
    { new: true }
  );
  if (!reserved) {
    await Refund.deleteOne({ _id: claim._id, status: "pending" });
    throw ApiError.conflict(
      "Refund amount exceeds what's left to refund — another refund may have just been processed. Please retry."
    );
  }
  // Guarded on "pending": if something already settled the claim, its reservation is left alone
  // (stays reserved — the safe direction).
  await Refund.updateOne({ _id: claim._id, status: "pending" }, { $set: { amountReserved: true } });
  claim.amountReserved = true;

  return callProviderAndRecord(claim, payment, provider, { onRejected: "delete", actorUserId: initiatedByUserId, actorRole: "staff" });
}

/** The provider this payment's refunds must go through — the SAME credentials the original charge
 *  used, never whatever the pooled default currently resolves to, and never a "currently active"
 *  BYOC account that might differ from the one this payment actually ran on.
 *  `restaurantPaymentAccountId` is looked up regardless of its current status (even `disconnected`,
 *  which is a soft transition precisely so a historical payment's refund path stays resolvable — see
 *  RestaurantPaymentAccount.ts). */
async function refundProviderFor(payment: HydratedDocument<PaymentDoc>): Promise<PaymentProvider> {
  if (!payment.restaurantPaymentAccountId) return getPaymentProvider();
  const account = await RestaurantPaymentAccount.findById(payment.restaurantPaymentAccountId);
  if (!account) throw new Error(`This payment's restaurant payment account (${payment.restaurantPaymentAccountId}) no longer exists.`);
  return buildProviderFromAccount(account);
}

/** Stable across every retry of one logical refund (the client's idempotency key, scoped to the
 *  restaurant), so a provider that honors idempotency keys can never create a second refund. Also
 *  attached to the provider's refund (Stripe metadata) so it can be found again by lookup. */
export function providerRefundIdempotencyKey(restaurantId: string, idempotencyKey: string): string {
  return `gt_refund_${createHash("sha256").update(`${restaurantId}:${idempotencyKey}`).digest("hex")}`;
}

const REFUND_ON_HOLD_MESSAGE =
  "The payment provider didn't confirm this refund, so it may or may not have gone through. It's on hold — the amount stays reserved so it can't be refunded twice. Open the order's payment panel to check it with the provider or resolve it.";

/** Stripe keeps an idempotency key for at least 24 hours (docs.stripe.com/api/idempotent_requests),
 *  then may prune it — a same-key request after that can create a NEW refund. Re-issuing a held
 *  refund is therefore only ever done inside this window (with a safety margin), after a lookup. */
export const PROVIDER_IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;
/** Staff may only confirm "not refunded" after a refund has been held this long (gives the provider
 *  time to finish anything still in flight)… */
export const MANUAL_NOT_REFUNDED_MIN_HOLD_MS = 30 * 60 * 1000;
/** …and, for a provider with lookup, only on a "not found" lookup at most this old. */
export const LOOKUP_EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;

/** A claim with no provider reference and no recorded outcome older than this was interrupted mid-call
 *  (e.g. the API restarted): the provider may or may not have refunded, so it is treated as held.
 *  Far longer than a provider call can take (two requests × REQUEST_TIMEOUT_MS). */
export const STALE_REFUND_CLAIM_MS = 5 * 60 * 1000;

/** Held = still pending, and nobody knows whether the provider refunded: the call's outcome was
 *  unknown, or the request was interrupted before recording any answer. */
export function isHeld(refund: Pick<RefundDoc, "status" | "providerOutcomeUnknown" | "providerRefundRef"> & { createdAt: Date }): boolean {
  if (refund.status !== "pending") return false;
  if (refund.providerOutcomeUnknown) return true;
  return !refund.providerRefundRef && Date.now() - refund.createdAt.getTime() > STALE_REFUND_CLAIM_MS;
}

type ActorContext = { actorUserId: string; actorRole: string };

/**
 * Calls the provider for a claimed refund whose amount is already reserved, then records the result.
 *  - provider definitively refused ("rejected"): a fresh claim releases its reservation and is
 *    deleted (same key can retry); a held refund being re-issued stays held (see below);
 *  - outcome unknown (timeout, dropped connection, 5xx, anything unclassified): money may have moved,
 *    so KEEP the reservation and hold the refund (providerOutcomeUnknown) — it can never be issued
 *    twice — and answer 503;
 *  - a result: applied through applyRefundOutcome — pending/requires_action keep the reservation,
 *    failed releases it, succeeded completes it.
 */
async function callProviderAndRecord(
  claim: HydratedDocument<RefundDoc>,
  payment: HydratedDocument<PaymentDoc>,
  provider: PaymentProvider,
  ctx: ActorContext & { onRejected: "delete" | "hold" }
): Promise<HydratedDocument<RefundDoc>> {
  let result: ProviderRefundResult;
  try {
    result = await provider.refund(payment.providerRef!, claim.amount, claim.reason ?? undefined, {
      idempotencyKey: claim.providerRefundKey ?? providerRefundIdempotencyKey(claim.restaurantId.toString(), claim.idempotencyKey!),
    });
  } catch (err) {
    if (err instanceof ProviderRequestError && err.outcome === "rejected") {
      if (ctx.onRejected === "delete") {
        await Payment.updateOne({ _id: payment._id }, { $inc: { totalRefunded: -claim.amount } });
        await Refund.deleteOne({ _id: claim._id, status: "pending" });
        throw err;
      }
      // Re-issuing a held refund: a refusal of the SAME key doesn't prove there's no refund (Stripe
      // answers a concurrent same-key request, or a key it remembers with different parameters, with
      // a 4xx) — so the refund stays held, its amount reserved.
      logger.warn("re-issue of a held refund refused — refund stays held", { refundId: claim.id, error: err.message });
      throw err;
    }
    await Refund.updateOne({ _id: claim._id, status: "pending" }, { $set: { providerOutcomeUnknown: true } });
    await recordAuditEvent({
      restaurantId: claim.restaurantId,
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      action: "payment.refund_held",
      targetType: "payment",
      targetId: payment._id,
      metadata: { refundId: claim.id, amount: claim.amount, provider: provider.name, error: (err as Error).message },
    });
    logger.error("refund outcome unknown — held for reconciliation", {
      refundId: claim.id,
      paymentId: payment.id,
      provider: provider.name,
      error: (err as Error).message,
    });
    throw ApiError.serviceUnavailable(REFUND_ON_HOLD_MESSAGE);
  }

  return applyRefundOutcome(claim, result, { ...ctx, method: "provider_response" });
}

const REFUND_TRANSITIONS: Record<string, string[]> = {
  pending: ["succeeded", "failed"],
  // A provider can report a refund that had succeeded as failed later (Stripe "failed refunds").
  succeeded: ["failed"],
  failed: [],
};

/**
 * The ONE place a refund changes status, from any source (provider response, lookup, webhook, a
 * person). Duplicate, out-of-order and concurrent updates are safe: the status change is a single
 * conditional update guarded by the current status, so each transition — and its effect on the
 * reservation — happens exactly once, and a stale "pending" can never override a final status.
 *  - entering "failed" releases the reserved amount (the ONLY way a reservation is released here);
 *  - entering "succeeded" applies the payment's refunded status, loyalty reversal and notification;
 *  - "pending" (incl. provider requires_action) only records the provider's reference and status.
 */
async function applyRefundOutcome(
  refund: HydratedDocument<RefundDoc>,
  update: { status: LocalRefundStatus; refundRef?: string; providerStatus?: string },
  ctx: ActorContext & { method: "provider_response" | "provider_lookup" | "webhook" | "manual"; evidence?: string }
): Promise<HydratedDocument<RefundDoc>> {
  const current = await Refund.findById(refund._id);
  if (!current) return refund;
  const from = current.status;
  const to = update.status;
  const details: Record<string, unknown> = {
    ...(update.refundRef && !current.providerRefundRef ? { providerRefundRef: update.refundRef } : {}),
    ...(update.providerStatus ? { providerStatus: update.providerStatus } : {}),
  };

  if (from === to) {
    // No status change — but a definitive provider answer means the outcome is no longer unknown.
    await Refund.updateOne({ _id: current._id }, { $set: details, ...(ctx.method !== "manual" ? { $unset: { providerOutcomeUnknown: "" } } : {}) });
    return (await Refund.findById(current._id))!;
  }
  if (!REFUND_TRANSITIONS[from]?.includes(to)) {
    logger.warn("ignored refund status change", { refundId: current.id, from, to, method: ctx.method });
    return current;
  }

  const resolution =
    ctx.method === "provider_response"
      ? undefined
      : {
          method: ctx.method,
          outcome: to === "succeeded" ? "refunded" : "not_refunded",
          providerRefundRef: update.refundRef ?? current.providerRefundRef,
          evidence: ctx.evidence,
          resolvedByUserId: ctx.actorRole === "system" ? undefined : ctx.actorUserId,
          resolvedAt: new Date(),
        };
  // The returned document is the one BEFORE this update, so the reservation decision below uses
  // the reservation state this transition actually replaced.
  const before = await Refund.findOneAndUpdate(
    { _id: current._id, status: from },
    {
      $set: { ...details, status: to, amountReserved: to !== "failed", ...(resolution ? { resolution } : {}) },
      $unset: { providerOutcomeUnknown: "" },
    },
    { new: false }
  );
  if (!before) return (await Refund.findById(current._id))!; // another update won the race
  const updated = (await Refund.findById(current._id))!;

  // An amount counted against the payment (a reservation, or a refund that had succeeded) is given
  // back only on entering "failed"; a refund that succeeds without a recorded reservation (a claim
  // interrupted before it reserved) is counted now — so totalRefunded always covers every success.
  const counted = Boolean(before.amountReserved) || before.status === "succeeded";
  if (to === "failed" && counted) {
    await Payment.updateOne({ _id: updated.paymentId }, { $inc: { totalRefunded: -updated.amount } });
  } else if (to === "succeeded" && !counted) {
    await Payment.updateOne({ _id: updated.paymentId }, { $inc: { totalRefunded: updated.amount } });
  }
  const paymentStatus = await syncPaymentRefundStatus(updated.paymentId);

  if (ctx.method !== "provider_response" || to === "failed") {
    await recordAuditEvent({
      restaurantId: updated.restaurantId,
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      action: "payment.refund_reconciled",
      targetType: "payment",
      targetId: updated.paymentId,
      metadata: {
        refundId: updated.id,
        from,
        to,
        method: ctx.method,
        amount: updated.amount,
        providerStatus: update.providerStatus,
        providerRefundRef: updated.providerRefundRef,
        ...(ctx.evidence ? { evidence: ctx.evidence } : {}),
      },
    });
  }

  if (to === "succeeded") {
    const order = await Order.findById(updated.orderId);
    if (order) {
      // A FULL refund reverses this order's loyalty impact — a partial refund does not, since we
      // can't know which portion of a part-refunded order the earned/redeemed points corresponded
      // to without a much finer-grained accounting than this system has. See loyalty.service.ts's
      // reverseLoyaltyForOrderIfNeeded doc comment for the cancellation case this shares logic with.
      if (paymentStatus === "refunded") await reverseLoyaltyForOrderIfNeeded(order);

      // Refund confirmation reuses the same order-event/notification pipeline as a payment
      // succeeding/failing (see processProviderEvent above) rather than a bespoke one — fires for
      // both partial and full refunds, since the customer paid real money back either way.
      emitOrderEvent("order.payment_updated", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId.toString(),
        customerId: order.customerId.toString(),
        status: order.status,
        paymentOutcome: "refunded",
        amount: updated.amount,
      });
    }
  }
  return updated;
}

/** A payment's refunded status from its SUCCEEDED refunds (reserved-but-unconfirmed amounts don't
 *  count as refunded). Only touches payments already in a refundable/refunded state. */
async function syncPaymentRefundStatus(paymentId: unknown): Promise<string | null> {
  const payment = await Payment.findById(paymentId).select("amount status");
  if (!payment || !["paid", "partially_refunded", "refunded"].includes(payment.status)) return payment?.status ?? null;
  const [agg] = await Refund.aggregate<{ total: number }>([
    { $match: { paymentId: payment._id, status: "succeeded" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  const succeeded = roundCurrency(agg?.total ?? 0);
  const next = succeeded >= payment.amount ? "refunded" : succeeded > 0 ? "partially_refunded" : "paid";
  if (next !== payment.status) await Payment.updateOne({ _id: payment._id }, { $set: { status: next } });
  return next;
}

export type RefundReconcileOutcome =
  | "already_final"
  | "in_progress"
  | "found"
  | "reissued"
  | "not_found"
  | "inconclusive"
  | "manual_required";

/**
 * Checks a waiting refund against the provider's own records (never trusting silence):
 *  - provider without lookup (Safepay): nothing automatic — "manual_required";
 *  - lookup failed / inconclusive: stays held — "inconclusive" (never read as "not found");
 *  - found: its real status is applied (succeeded / failed / still pending);
 *  - definitively not found: recorded as evidence for staff; with `allowReissue`, inside the
 *    provider's idempotency window, for an idempotent provider, it is re-issued with the SAME key.
 */
export async function reconcileRefund(
  refund: HydratedDocument<RefundDoc>,
  opts: ActorContext & { allowReissue?: boolean }
): Promise<{ refund: HydratedDocument<RefundDoc>; outcome: RefundReconcileOutcome }> {
  if (refund.status !== "pending") return { refund, outcome: "already_final" };
  // A request is still waiting on the provider for this refund — never race it.
  if (!isHeld(refund) && !refund.providerRefundRef) return { refund, outcome: "in_progress" };
  const payment = await Payment.findById(refund.paymentId);
  if (!payment) return { refund, outcome: "manual_required" };
  const provider = await refundProviderFor(payment);
  if (!provider.supportsRefundLookup) return { refund, outcome: "manual_required" };

  const refundKey = refund.providerRefundKey ?? providerRefundIdempotencyKey(refund.restaurantId.toString(), refund.idempotencyKey!);
  let result;
  try {
    result = await provider.lookupRefund({ providerRef: payment.providerRef!, refundKey, refundRef: refund.providerRefundRef ?? undefined });
  } catch (err) {
    await Refund.updateOne({ _id: refund._id }, { $set: { lastLookupAt: new Date(), lastLookupResult: "inconclusive" } });
    logger.warn("refund lookup inconclusive — refund stays held", { refundId: refund.id, error: (err as Error).message });
    return { refund: (await Refund.findById(refund._id))!, outcome: "inconclusive" };
  }

  if (result.found) {
    await Refund.updateOne({ _id: refund._id }, { $set: { lastLookupAt: new Date(), lastLookupResult: "found" } });
    const applied = await applyRefundOutcome(
      refund,
      { status: result.status, refundRef: result.refundRef, providerStatus: result.providerStatus },
      { ...opts, method: "provider_lookup" }
    );
    return { refund: applied, outcome: "found" };
  }

  await Refund.updateOne({ _id: refund._id }, { $set: { lastLookupAt: new Date(), lastLookupResult: "not_found" } });
  const fresh = (await Refund.findById(refund._id))!;
  const withinWindow = Date.now() - fresh.createdAt.getTime() < PROVIDER_IDEMPOTENCY_WINDOW_MS;
  if (opts.allowReissue && provider.supportsRefundIdempotency && !fresh.providerRefundRef && fresh.amountReserved && withinWindow) {
    // One re-issue at a time: two concurrent retries must never both call the provider.
    const leased = await Refund.findOneAndUpdate(
      { _id: fresh._id, status: "pending", $or: [{ reissueLeaseUntil: null }, { reissueLeaseUntil: { $lt: new Date() } }] },
      { $set: { reissueLeaseUntil: new Date(Date.now() + STALE_REFUND_CLAIM_MS) } },
      { new: true }
    );
    if (!leased) return { refund: fresh, outcome: "in_progress" };
    try {
      // The amount is still reserved for this held refund; the same key can't create a second refund.
      const reissued = await callProviderAndRecord(leased, payment, provider, { ...opts, onRejected: "hold" });
      return { refund: reissued, outcome: "reissued" };
    } catch (err) {
      logger.warn("held refund re-issue did not get a definitive answer — stays held", { refundId: fresh.id, error: (err as Error).message });
      return { refund: (await Refund.findById(fresh._id))!, outcome: "inconclusive" };
    } finally {
      await Refund.updateOne({ _id: fresh._id }, { $unset: { reissueLeaseUntil: "" } });
    }
  }
  return { refund: fresh, outcome: "not_found" };
}

/**
 * A person settles a held refund, with evidence. Requires restaurant.payments.manage (route) and:
 *  - "refunded": the provider's refund reference and a written explanation;
 *  - "not_refunded" (releases the reserved amount): an explicit confirmation, a written explanation,
 *    the refund held for at least MANUAL_NOT_REFUNDED_MIN_HOLD_MS, and — for a provider that supports
 *    lookup — a "not found" lookup no older than LOOKUP_EVIDENCE_MAX_AGE_MS. A button alone never
 *    releases money. Recorded on the refund (resolution) and as an audit event.
 */
export async function resolveHeldRefund(
  refund: HydratedDocument<RefundDoc>,
  input: { outcome: "refunded" | "not_refunded"; providerRefundRef?: string; evidence: string; confirmChecked: boolean },
  actor: ActorContext
): Promise<HydratedDocument<RefundDoc>> {
  if (refund.status !== "pending") throw ApiError.conflict("This refund is already settled.");
  if (!isHeld(refund) && !refund.providerRefundRef) {
    throw ApiError.conflict("This refund is still being processed. Try again in a moment.");
  }
  const evidence = input.evidence.trim();
  if (input.outcome === "refunded") {
    const ref = input.providerRefundRef?.trim();
    if (!ref) throw ApiError.badRequest("Enter the provider's refund reference from its dashboard.");
    return applyRefundOutcome(refund, { status: "succeeded", refundRef: ref, providerStatus: "confirmed_manually" }, { ...actor, method: "manual", evidence });
  }

  if (!input.confirmChecked) throw ApiError.badRequest("Confirm that you checked the provider's dashboard and this refund doesn't exist there.");
  const heldFor = Date.now() - refund.createdAt.getTime();
  if (heldFor < MANUAL_NOT_REFUNDED_MIN_HOLD_MS) {
    const minutes = Math.ceil((MANUAL_NOT_REFUNDED_MIN_HOLD_MS - heldFor) / 60000);
    throw ApiError.conflict(`Give the provider time to finish first — you can confirm this in ${minutes} minute(s).`);
  }
  const payment = await Payment.findById(refund.paymentId);
  const provider = payment ? await refundProviderFor(payment) : null;
  if (provider?.supportsRefundLookup) {
    const fresh =
      refund.lastLookupResult === "not_found" && refund.lastLookupAt && Date.now() - refund.lastLookupAt.getTime() <= LOOKUP_EVIDENCE_MAX_AGE_MS;
    if (!fresh) {
      throw ApiError.conflict(`Check with ${provider.name} first — it must report no such refund (within the last 15 minutes) before this can be confirmed.`);
    }
  }
  return applyRefundOutcome(refund, { status: "failed", providerStatus: "confirmed_not_refunded" }, { ...actor, method: "manual", evidence });
}

/**
 * A refund status update from a provider webhook (e.g. Stripe refund.updated). The event itself is
 * de-duplicated by processProviderEvent (PaymentWebhookEvent); the change goes through
 * applyRefundOutcome, so duplicates and out-of-order deliveries can't double-apply or regress.
 * Finds the refund by the provider's refund id, or by our refund key echoed back in its metadata.
 */
export async function applyProviderRefundUpdate(
  providerName: string,
  update: ProviderRefundUpdate,
  restaurantPaymentAccountId?: string
): Promise<void> {
  const refund =
    (await Refund.findOne({ provider: providerName, providerRefundRef: update.refundRef })) ??
    (update.refundKey ? await Refund.findOne({ provider: providerName, providerRefundKey: update.refundKey }) : null);
  if (!refund) {
    logger.warn("refund webhook for an unknown refund", { provider: providerName, refundRef: update.refundRef });
    return;
  }
  // Only the account the original payment ran on (or the pooled platform account, for a payment
  // without one) can update its refund.
  const payment = await Payment.findById(refund.paymentId).select("restaurantPaymentAccountId");
  if (String(payment?.restaurantPaymentAccountId ?? "") !== String(restaurantPaymentAccountId ?? "")) {
    logger.warn("refund webhook from a different payment account ignored", { provider: providerName, refundId: refund.id });
    return;
  }
  await applyRefundOutcome(
    refund,
    { status: update.status, refundRef: update.refundRef, providerStatus: update.providerStatus },
    { actorUserId: refund.initiatedByUserId.toString(), actorRole: "system", method: "webhook" }
  );
}

/** Refunds that need attention: held with an unknown outcome, or pending at the provider. */
export async function listWaitingRefunds(filter: { restaurantId?: string; paymentId?: string } = {}) {
  return Refund.find({ status: "pending", ...filter }).sort({ createdAt: 1 });
}

export interface RefundStaffView {
  /** Held because the provider never confirmed the outcome (amount reserved). */
  held: boolean;
  /** Accepted by the provider but not final yet (amount reserved). */
  waitingOnProvider: boolean;
  canCheckWithProvider: boolean;
  /** Only for a held refund at an idempotent provider, inside its idempotency window. */
  canRetry: boolean;
  /** When "confirm not refunded" becomes possible (also needs a fresh "not found" lookup where supported). */
  manualNotRefundedAvailableAt: string | null;
  nextAction: string | null;
}

/** What staff need to see and do about a refund — computed server-side from the real provider. */
export async function describeRefundForStaff(refund: HydratedDocument<RefundDoc>, providerCache = new Map<string, PaymentProvider | null>()): Promise<RefundStaffView> {
  const base: RefundStaffView = { held: false, waitingOnProvider: false, canCheckWithProvider: false, canRetry: false, manualNotRefundedAvailableAt: null, nextAction: null };
  if (refund.status !== "pending") return base;
  const key = refund.paymentId.toString();
  if (!providerCache.has(key)) {
    const payment = await Payment.findById(refund.paymentId);
    providerCache.set(key, payment ? await refundProviderFor(payment).catch(() => null) : null);
  }
  const provider = providerCache.get(key) ?? null;
  const lookup = Boolean(provider?.supportsRefundLookup);
  const name = refund.provider;
  const held = isHeld(refund);
  if (!held && !refund.providerRefundRef) {
    return { ...base, nextAction: "Being processed — refresh in a moment." };
  }
  const availableAt = new Date(refund.createdAt.getTime() + MANUAL_NOT_REFUNDED_MIN_HOLD_MS).toISOString();
  if (!held) {
    return {
      ...base,
      waitingOnProvider: true,
      canCheckWithProvider: lookup,
      nextAction: lookup
        ? `Waiting for ${name} to finish this refund. Use “Check with ${name}” to update it.`
        : `Waiting for ${name} to finish this refund. Confirm the result in the ${name} dashboard, then record it here.`,
    };
  }
  const withinWindow = Date.now() - refund.createdAt.getTime() < PROVIDER_IDEMPOTENCY_WINDOW_MS;
  return {
    ...base,
    held: true,
    canCheckWithProvider: lookup,
    canRetry: lookup && Boolean(provider?.supportsRefundIdempotency) && Boolean(refund.amountReserved) && !refund.providerRefundRef && withinWindow,
    manualNotRefundedAvailableAt: availableAt,
    nextAction: lookup
      ? `On hold: ${name} didn't confirm this refund. Use “Check with ${name}” — it finds the refund if it was made, or confirms it wasn't.`
      : `On hold: ${name} didn't confirm this refund and it can't be checked automatically. Look for it in the ${name} dashboard, then record what you find (refund reference if it exists).`,
  };
}
