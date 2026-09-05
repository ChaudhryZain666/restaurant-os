/**
 * Result of checking whether a given coordinate is deliverable from a restaurant — returned by
 * both the customer-facing "check my address" preview (POST /restaurants/:id/delivery/check) and
 * consulted internally by createOrder itself, so a location can never be shown as deliverable at
 * checkout-preview time and then rejected (or vice versa) when the order is actually placed. See
 * docs/delivery-architecture.md.
 */
export interface DeliveryEligibilityResult {
  eligible: boolean;
  /** Present whenever both the restaurant and the queried point have coordinates, regardless of
   *  eligibility — lets the UI show "6.2km away" even when that's outside range. */
  distanceKm?: number;
  /** The fee that would apply if eligible — server-authoritative, echoes settings.deliveryFee. */
  deliveryFee?: number;
  /** Customer-facing reason when `eligible` is false, e.g. "Outside delivery area" or "This
   *  restaurant hasn't set up delivery yet." */
  reason?: string;
}

/**
 * Phase 40 — courier DISPATCH, a different concern from the eligibility/fee check above (which
 * only answers "can we deliver here, for how much" and is unchanged). This is the normalized
 * internal lifecycle a Delivery moves through regardless of which courier provider is behind it —
 * see docs/delivery-integrations.md. External provider statuses are always mapped into this set;
 * nothing outside the provider adapter ever sees a raw provider status string.
 */
export const DELIVERY_STATUSES = [
  "pending",
  "quoted",
  "requested",
  "accepted",
  "driver_assigned",
  "picked_up",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "failed",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** "manual" (a restaurant's own fleet/rider, always available, zero configuration) is a real
 *  first-class provider, not a placeholder — see Delivery.provider's own doc comment. */
export const DELIVERY_PROVIDER_NAMES = ["manual", "uber_direct"] as const;
export type DeliveryProviderName = (typeof DELIVERY_PROVIDER_NAMES)[number];

export interface DeliveryStatusHistoryEntry {
  status: DeliveryStatus;
  at: string;
  /** Present only for provider-driven transitions (a webhook event) — absent for a manual/staff
   *  action, which is how the UI tells the two apart without a separate boolean. */
  providerEventId?: string;
  note?: string;
}

export interface Delivery {
  id: string;
  restaurantId: string;
  businessId?: string;
  orderId: string;
  orderNumber: string;
  provider: DeliveryProviderName;
  status: DeliveryStatus;
  statusHistory: DeliveryStatusHistoryEntry[];
  fee?: number;
  currency?: string;
  quoteId?: string;
  providerDeliveryId?: string;
  trackingUrl?: string;
  courierName?: string;
  courierPhone?: string;
  pickupEta?: string;
  dropoffEta?: string;
  cancelReason?: string;
  failureReason?: string;
  lastProviderError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantDeliveryProviderAccount {
  id: string;
  restaurantId: string;
  businessId: string;
  provider: DeliveryProviderName;
  status: "pending_verification" | "active" | "invalid" | "disconnected";
  /** Display-safe, never reversible — e.g. "customer_id ····4a2f" — same fingerprint-not-secret
   *  pattern as RestaurantPaymentAccount. */
  credentialFingerprint?: string;
  lastVerifiedAt?: string;
  lastVerificationError?: string;
  createdAt: string;
  updatedAt: string;
}
