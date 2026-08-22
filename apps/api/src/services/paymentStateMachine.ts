import type { PaymentStatus } from "../models/Payment.js";

/**
 * Governs transitions driven by inbound provider events only. "refunded"/"partially_refunded"
 * are deliberately absent here — those are only ever set by payment.service.ts's refundPayment(),
 * which has its own guard (payment must already be "paid" or "partially_refunded"), not by a
 * webhook event carrying a payment status. Mirrors services/orderStateMachine.ts's shape.
 */
const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["requires_action", "authorized", "paid", "failed", "cancelled"],
  requires_action: ["authorized", "paid", "failed", "cancelled"],
  authorized: ["paid", "failed", "cancelled"],
  paid: [],
  failed: [],
  cancelled: [],
  refunded: [],
  partially_refunded: [],
};

export function isValidPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
