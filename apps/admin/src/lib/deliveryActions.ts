import type { Delivery } from "@restaurant/types";

/**
 * Phase 89 — whether staff may take a delivery over with their own riders (POST …/delivery/
 * dispatch-manually): only a third-party courier booking that FAILED before any courier was booked.
 * Mirrors the server's own conditions (deliveryDispatch.service.ts's switchDeliveryToManual), which
 * remain the authority — this only decides whether to offer the button.
 */
export function canSwitchToOwnStaff(delivery: Pick<Delivery, "provider" | "status" | "providerDeliveryId">): boolean {
  return delivery.provider !== "manual" && delivery.status === "failed" && !delivery.providerDeliveryId;
}
