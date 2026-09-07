import type { DeliveryStatus } from "@restaurant/types";

/**
 * Phase 50 — customer-facing copy for a Delivery's normalized status (see
 * apps/admin/src/components/DeliveryStatusPanel.tsx's own STATUS_LABELS for the staff-facing
 * equivalent; deliberately worded differently here — a customer doesn't need to know a courier was
 * "requested" versus "accepted", just what it means for their order).
 */
export const DELIVERY_STATUS_CUSTOMER_LABELS: Record<DeliveryStatus, string> = {
  pending: "Waiting for a courier",
  quoted: "Getting a courier quote",
  requested: "Requesting a courier",
  accepted: "A courier has accepted your delivery",
  driver_assigned: "Your courier is on the way to the restaurant",
  picked_up: "Your courier has picked up your order",
  out_for_delivery: "Your order is on its way",
  delivered: "Delivered",
  cancelled: "Delivery cancelled",
  // Never the raw failureReason — that's a staff-facing diagnostic (see CustomerFacingDelivery's
  // own doc comment for exactly what's withheld from this view).
  failed: "We're arranging an alternative for this delivery — the restaurant has been notified",
};
