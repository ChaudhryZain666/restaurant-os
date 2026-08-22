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
