import { EventEmitter } from "node:events";
import type { OrderStatus } from "@restaurant/types";

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
