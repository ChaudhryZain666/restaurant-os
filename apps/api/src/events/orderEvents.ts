import { EventEmitter } from "node:events";
import type { OrderStatus } from "@restaurant/types";
import type { ProviderPaymentStatus } from "../payments/PaymentProvider.js";

/**
 * Conceptual lifecycle events (ORDER_CREATED / ORDER_ACCEPTED / ORDER_PREPARING / ORDER_READY /
 * ORDER_COMPLETED / ORDER_CANCELLED from the product spec). "created" covers the initial
 * "pending" state; every other event name matches an OrderStatus 1:1 — "confirmed" is this
 * codebase's existing name for what the spec calls "accepted" (see orderStateMachine.ts).
 */
export type OrderEventType =
  | "order.created"
  | "order.confirmed"
  | "order.preparing"
  | "order.ready"
  | "order.out_for_delivery"
  | "order.completed"
  | "order.cancelled"
  // Fired whenever a Payment's status changes an order's paymentStatus (webhook-confirmed online
  // payments, and cash mark-paid/unpaid) — reuses this same bus/socket/queue pipeline rather than
  // inventing a parallel one for payment updates specifically.
  | "order.payment_updated";

export interface OrderEventPayload {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  customerId: string;
  status: OrderStatus;
  // Phase 34, additive — only ever set on "order.payment_updated". Order.paymentStatus is a binary
  // unpaid/paid flag (see Order.ts), not enough on its own to tell a receipt email from a
  // payment-failed notice, or a refund confirmation from either — this carries the Payment's own
  // outcome (or "refunded", which has no ProviderPaymentStatus equivalent) for that one event type.
  paymentOutcome?: ProviderPaymentStatus | "refunded";
  // Phase 34, additive — only ever set alongside paymentOutcome:"refunded", the actual refunded
  // amount (which may be less than the order's own total for a partial refund — Order.total alone
  // would overstate a partial refund's confirmation email).
  amount?: number;
}

/**
 * Foundation only: an in-process bus that decouples "an order's status changed" from whoever
 * reacts to it. Today that's a Socket.IO push and a logged BullMQ job (see
 * registerOrderEventListeners); email/SMS/WhatsApp/push/analytics consumers can subscribe here
 * later without touching order.controller.ts again.
 */
export const orderEventBus = new EventEmitter();

export function emitOrderEvent(type: OrderEventType, payload: OrderEventPayload): void {
  orderEventBus.emit(type, payload);
}

export function statusToEventType(status: OrderStatus): OrderEventType {
  return status === "pending" ? "order.created" : (`order.${status}` as OrderEventType);
}
