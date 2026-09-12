import type { HydratedDocument } from "mongoose";
import { Order } from "../models/Order.js";
import { Payment, type PaymentDoc } from "../models/Payment.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { getPosTerminalProvider } from "../payments/terminal/index.js";
import { applyPaymentStatusTransition } from "./payment.service.js";
import { isValidPaymentTransition } from "./paymentStateMachine.js";

/**
 * Phase 74 — the POS analog of payment.service.ts's createPaymentForOrder, for a physical
 * card-terminal attempt instead of an online hosted-checkout one. Deliberately reuses the exact
 * same Payment model, idempotency-key mechanism, and (via applyPaymentStatusTransition) atomic
 * transition path — a terminal payment is a genuinely real Payment document (method:
 * "pos_terminal"), not a second, parallel bookkeeping system.
 *
 * Two independent server-side gates, checked BEFORE ever calling the provider — mirrors
 * pos.controller.ts's own posEnabled check exactly: env.POS_TERMINAL_PROVIDER !== "none" (does
 * this deployment have ANY terminal capability at all) AND
 * restaurant.settings.posTerminalEnabled (has THIS location opted in) must both hold. Neither
 * check is inferrable from the other, and neither is trusted from the client — a request that
 * reaches here with the frontend somehow showing terminal UI it shouldn't still gets a clean 400.
 */
export async function createPosTerminalPayment(input: {
  restaurantId: string;
  orderId: string;
  idempotencyKey: string;
}): Promise<{ payment: HydratedDocument<PaymentDoc>; created: boolean }> {
  const { restaurantId, orderId, idempotencyKey } = input;

  const existingByKey = await Payment.findOne({ restaurantId, idempotencyKey });
  if (existingByKey) return { payment: existingByKey, created: false };

  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");
  if (order.channel !== "pos") throw ApiError.badRequest("Only a POS-created order can use the POS card terminal.");
  if (order.paymentStatus === "paid") throw ApiError.conflict("This order is already paid");
  // Phase 75 — a cancelled sale (e.g. abandoned and then cancelled from Pending Sales) must never
  // be resumable into a new payment attempt, same invariant order.controller.ts's
  // updateOrderPaymentStatus now enforces for the cash/staff-card path.
  if (order.status === "cancelled") throw ApiError.badRequest("This order has been cancelled and cannot accept a payment");

  // Reuse a still-in-flight attempt rather than starting a second one against the same terminal —
  // covers a re-render/duplicate submit; a genuinely new attempt after a failed/cancelled one is a
  // fresh idempotencyKey from the frontend (see TerminalCardPayment.tsx), same convention as
  // createPaymentForOrder's own "reusable" lookup.
  const reusable = await Payment.findOne({
    restaurantId,
    orderId,
    method: "pos_terminal",
    status: { $in: ["pending", "requires_action", "authorized"] },
  }).sort({ createdAt: -1 });
  if (reusable) return { payment: reusable, created: false };

  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound("Restaurant not found");
  if (!restaurant.settings.posTerminalEnabled) {
    throw ApiError.badRequest("A card terminal is not configured for this location.");
  }

  const provider = getPosTerminalProvider();
  const intent = await provider.createPayment({
    amount: order.total,
    currency: order.currency,
    orderId: order.id,
    restaurantId,
    metadata: { orderNumber: String(order.orderNumber) },
  });

  try {
    const payment = await Payment.create({
      restaurantId,
      orderId,
      customerId: order.customerId,
      method: "pos_terminal",
      provider: provider.name,
      providerRef: intent.providerRef,
      currency: order.currency,
      amount: order.total,
      status: intent.status,
      idempotencyKey,
    });
    return { payment, created: true };
  } catch (err) {
    // Same duplicate-key race handling as createPaymentForOrder — a concurrent request with the
    // identical idempotency key won; return what it created instead of a 500 to the loser.
    if ((err as { code?: number }).code === 11000) {
      const winner = await Payment.findOne({ restaurantId, idempotencyKey });
      if (winner) return { payment: winner, created: false };
    }
    throw err;
  }
}

async function loadTerminalPayment(restaurantId: string, orderId: string, paymentId: string): Promise<HydratedDocument<PaymentDoc>> {
  const payment = await Payment.findOne({ _id: paymentId, restaurantId, orderId, method: "pos_terminal" });
  if (!payment) throw ApiError.notFound("Terminal payment not found");
  return payment;
}

/**
 * Polled on-demand by the frontend while showing a live waiting/processing state — not just a
 * background job. If the payment is still in flight, asks the provider for its current status
 * (mirrors payment.service.ts's reconcileStalePayments logic, synchronous instead of scheduled)
 * and applies any real change through the shared atomic transition path. A terminal payment
 * reaching "paid" here sets Order.paymentStatus exactly the same way an online payment's webhook
 * does — no separate "mark POS order paid" step is needed once the terminal itself confirms it.
 */
export async function getPosTerminalPaymentStatus(
  restaurantId: string,
  orderId: string,
  paymentId: string
): Promise<HydratedDocument<PaymentDoc>> {
  const payment = await loadTerminalPayment(restaurantId, orderId, paymentId);
  const inFlight = payment.status === "pending" || payment.status === "requires_action" || payment.status === "authorized";
  if (!inFlight || !payment.providerRef) return payment;

  try {
    const provider = getPosTerminalProvider();
    const snapshot = await provider.retrieve(payment.providerRef);
    if (snapshot.status !== payment.status && isValidPaymentTransition(payment.status, snapshot.status)) {
      await applyPaymentStatusTransition(payment, snapshot.status);
      return loadTerminalPayment(restaurantId, orderId, paymentId);
    }
  } catch (err) {
    // A transient provider-side polling error shouldn't fail the staff's "what's the status"
    // check — surface the payment as still in-flight and let the next poll try again.
    logger.warn("terminal payment status poll failed", { paymentId, error: (err as Error).message });
  }
  return payment;
}

/**
 * Staff-initiated cancellation of a still-in-flight terminal attempt (Section 8.B/J) — tells the
 * (mock, today) provider to stop prompting the customer, then applies "cancelled" through the same
 * shared transition path. Always available regardless of provider, unlike the mock-only
 * simulate-outcome driver — a real terminal SDK's own cancel call is not a test-only capability.
 */
export async function cancelPosTerminalPayment(restaurantId: string, orderId: string, paymentId: string): Promise<HydratedDocument<PaymentDoc>> {
  const payment = await loadTerminalPayment(restaurantId, orderId, paymentId);
  const inFlight = payment.status === "pending" || payment.status === "requires_action" || payment.status === "authorized";
  if (!inFlight) return payment;

  if (payment.providerRef) {
    const provider = getPosTerminalProvider();
    await provider.cancel(payment.providerRef);
  }
  if (isValidPaymentTransition(payment.status, "cancelled")) {
    await applyPaymentStatusTransition(payment, "cancelled");
  }
  return loadTerminalPayment(restaurantId, orderId, paymentId);
}
