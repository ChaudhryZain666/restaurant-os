import type { OrderDoc } from "../models/Order.js";

/**
 * Phase 89 — which orders this platform may hand to a courier (its own staff or a third-party
 * courier such as Uber Direct). Checked server-side at both places a courier booking can start: the
 * automatic dispatch when an order becomes "ready" (orderTransition.service.ts) and the dispatch
 * service itself (deliveryDispatch.service.ts — createDeliveryForOrder and its staff Retry), so no
 * UI or job path can get around it. Dependency-free on purpose: orderTransition.service.ts and
 * deliveryDispatch.service.ts import each other's neighbours, and this must not add a cycle.
 *
 * Marketplace orders (channel "marketplace") are never eligible. Ingestion already maps every one
 * to orderType "pickup" because the marketplace's own couriers (or the diner) collect it — see
 * marketplaceOrderIngestion.service.ts — and there is no marketplace-to-courier flow in this
 * codebase; this keeps that true even if a marketplace order ever carried orderType "delivery".
 *
 * Returns null when eligible, otherwise the reason (suitable for an API error message).
 */
export function courierDispatchIneligibility(order: Pick<OrderDoc, "orderType" | "channel">): string | null {
  if (order.channel === "marketplace") {
    return "Marketplace orders are delivered by the marketplace's own couriers — they are never dispatched from GarnishTable";
  }
  if (order.orderType !== "delivery") return "Only delivery orders can be dispatched to a courier";
  return null;
}
