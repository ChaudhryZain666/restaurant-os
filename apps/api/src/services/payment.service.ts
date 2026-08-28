import mongoose, { type HydratedDocument } from "mongoose";
import { Order, type OrderDoc } from "../models/Order.js";
import { Payment, type PaymentDoc } from "../models/Payment.js";
import { Refund, type RefundDoc } from "../models/Refund.js";
import { PaymentWebhookEvent } from "../models/PaymentWebhookEvent.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { getPaymentProvider } from "../payments/index.js";
import { resolveEligiblePaymentProvider } from "../payments/eligibility.js";
import type { ProviderWebhookEvent } from "../payments/PaymentProvider.js";
import { isValidPaymentTransition } from "./paymentStateMachine.js";
import { emitOrderEvent } from "../events/orderEvents.js";
import { reverseLoyaltyForOrderIfNeeded } from "./loyalty.service.js";
import { env } from "../config/env.js";

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
    throw ApiError.badRequest('This order was placed with paymentMethod "cash" and has no online payment to create.');
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

  // Phase 34 — country/currency eligibility routing is opt-in (env.PAYMENT_ELIGIBILITY_ROUTING,
  // default false): every existing deployment/test/dev environment keeps today's exact behavior
  // (the single PAYMENT_PROVIDER-configured default, regardless of restaurant country) unless a
  // deployment deliberately turns this on. When enabled, a restaurant whose country has no eligible
  // configured provider gets a clear error rather than silently falling back to a provider that
  // doesn't actually serve that market — see payments/eligibility.ts.
  let provider = getPaymentProvider();
  if (env.PAYMENT_ELIGIBILITY_ROUTING) {
    const eligible = resolveEligiblePaymentProvider(restaurant);
    if (!eligible) {
      throw ApiError.badRequest("Online payment isn't available for this restaurant's country yet — please pay with cash.");
    }
    provider = getPaymentProvider(eligible.providerName);
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
 */
export async function processProviderEvent(providerName: string, event: ProviderWebhookEvent): Promise<void> {
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

  const payment = await Payment.findOne({ provider: providerName, providerRef: event.providerRef });
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

  const session = await mongoose.startSession();
  try {
    // Untyped, not `OrderDoc | null`: TypeScript can't carry a useful narrowed type for a `let`
    // only ever assigned inside an async closure passed to withTransaction (same limitation
    // order.controller.ts's createOrder already works around the same way) — cast at the one
    // usage site below instead of fighting the checker here.
    let orderAfter;
    await session.withTransaction(async () => {
      // Guarded by status: {$ne: to} so a race between two deliveries of the same real-world
      // transition can't apply it twice — combined with Payment's partial unique index on
      // {orderId: unique where status:"paid"}, this makes double-marking-paid effectively
      // impossible even under concurrent webhook delivery.
      const updated = await Payment.findOneAndUpdate(
        { _id: payment._id, status: { $ne: event.status } },
        { $set: { status: event.status } },
        { new: true, session }
      );
      if (!updated) return; // lost the race to an identical concurrent update — nothing left to do

      if (event.status === "paid") {
        orderAfter = await Order.findOneAndUpdate(
          { _id: payment.orderId, restaurantId: payment.restaurantId },
          { $set: { paymentStatus: "paid" } },
          { new: true, session }
        );
      } else if (event.status === "failed" || event.status === "cancelled") {
        orderAfter = await Order.findOne({ _id: payment.orderId, restaurantId: payment.restaurantId }).session(session);
      }
    });

    await PaymentWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processedAt: new Date() } }
    );

    const order = orderAfter as unknown as HydratedDocument<OrderDoc> | null;
    if (order) {
      emitOrderEvent("order.payment_updated", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        restaurantId: order.restaurantId.toString(),
        customerId: order.customerId.toString(),
        status: order.status,
        paymentOutcome: event.status,
      });
    }
  } finally {
    await session.endSession();
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
 * balance at write time (the actual guard), reserving the amount BEFORE the external call. If the
 * provider call throws, or the provider reports anything other than "succeeded", the reservation
 * is released again — only a genuinely succeeded refund permanently consumes it.
 */
export async function refundPayment(input: RefundInput): Promise<HydratedDocument<RefundDoc>> {
  const { restaurantId, paymentId, reason, initiatedByUserId, idempotencyKey } = input;

  const existingByKey = await Refund.findOne({ restaurantId, idempotencyKey });
  if (existingByKey) return existingByKey;

  const payment = await Payment.findOne({ _id: paymentId, restaurantId });
  if (!payment) throw ApiError.notFound("Payment not found");
  if (payment.status !== "paid" && payment.status !== "partially_refunded") {
    throw ApiError.badRequest(`Cannot refund a payment with status "${payment.status}"`);
  }

  const remaining = roundCurrency(payment.amount - payment.totalRefunded);
  const amount = input.amount ?? remaining;
  if (amount <= 0 || amount > remaining) {
    throw ApiError.badRequest(`Refund amount must be between 0 and ${remaining} (already refunded: ${payment.totalRefunded})`);
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
    throw ApiError.conflict(
      "Refund amount exceeds what's left to refund — another refund may have just been processed. Please retry."
    );
  }

  const provider = getPaymentProvider();
  let result;
  try {
    result = await provider.refund(payment.providerRef!, amount, reason);
  } catch (err) {
    await Payment.updateOne({ _id: payment._id }, { $inc: { totalRefunded: -amount } });
    throw err;
  }
  if (result.status !== "succeeded") {
    // Provider accepted the request but it didn't (yet) actually move money — release the
    // reservation. A "pending" provider refund later succeeding via a webhook is out of scope
    // today (refunds have no webhook confirmation path yet — see payment-provider-decision.md).
    await Payment.updateOne({ _id: payment._id }, { $inc: { totalRefunded: -amount } });
  }

  let refund: HydratedDocument<RefundDoc>;
  try {
    refund = await Refund.create({
      restaurantId,
      paymentId: payment._id,
      orderId: payment.orderId,
      provider: provider.name,
      providerRefundRef: result.refundRef,
      amount,
      reason,
      status: result.status,
      idempotencyKey,
      initiatedByUserId,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const winner = await Refund.findOne({ restaurantId, idempotencyKey });
      if (winner) return winner;
    }
    throw err;
  }

  if (result.status === "succeeded") {
    const nextStatus = reserved.totalRefunded >= payment.amount ? "refunded" : "partially_refunded";
    await Payment.updateOne({ _id: payment._id }, { $set: { status: nextStatus } });

    const order = await Order.findById(payment.orderId);
    if (order) {
      // A FULL refund reverses this order's loyalty impact — a partial refund does not, since we
      // can't know which portion of a part-refunded order the earned/redeemed points corresponded
      // to without a much finer-grained accounting than this system has. See loyalty.service.ts's
      // reverseLoyaltyForOrderIfNeeded doc comment for the cancellation case this shares logic with.
      if (nextStatus === "refunded") await reverseLoyaltyForOrderIfNeeded(order);

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
        amount,
      });
    }
  }

  return refund;
}
