import type { RestaurantDoc } from "../models/Restaurant.js";

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Straight-line (great-circle) distance between two coordinates, in kilometers — the standard
 * Haversine formula. This is deliberately NOT a road/driving distance (that would require a
 * routing provider this codebase doesn't have; LocationIQ (services/geocoding/) resolves an
 * address to a POINT, not a route); it's a reasonable, honest approximation for a
 * radius-based delivery-eligibility check, not a precise ETA/route calculation.
 */
export function haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface DeliveryEligibility {
  eligible: boolean;
  distanceKm?: number;
  deliveryFee?: number;
  reason?: string;
}

/**
 * Phase 28 — resolves the actual fee for a given distance: the configured tier with the SMALLEST
 * maxDistanceKm that still covers the distance (the tightest-fitting bracket, not just any match),
 * falling back to the flat `deliveryFee` when no tiers are configured or none cover the distance
 * (the latter shouldn't happen in practice since eligibility already caps distance at
 * deliveryRadiusKm, but a fallback keeps this total rather than throwing on a misconfiguration).
 */
function resolveDeliveryFee(settings: Pick<RestaurantDoc["settings"], "deliveryFee" | "deliveryFeeTiers">, distanceKm: number): number {
  const tiers = settings.deliveryFeeTiers ?? [];
  const covering = tiers.filter((t) => distanceKm <= t.maxDistanceKm);
  if (covering.length === 0) return settings.deliveryFee;
  return covering.reduce((tightest, t) => (t.maxDistanceKm < tightest.maxDistanceKm ? t : tightest)).fee;
}

/**
 * The single source of truth for "can this restaurant deliver to this point, and for how much" —
 * used by both the customer-facing preview (delivery.controller.ts's checkDeliveryEligibility)
 * and createOrder itself, so a location can never be shown as deliverable at preview time and
 * then rejected (or vice versa) when the order is actually placed. Mirrors
 * promotion.service.ts's validatePromoCode in that regard.
 *
 * Never trusts a caller-supplied distance or fee — both are always computed here from the
 * restaurant's own stored coordinates/settings and the customer coordinates passed in.
 */
export function checkDeliveryEligibility(
  restaurant: Pick<RestaurantDoc, "settings" | "latitude" | "longitude">,
  customerLat: number,
  customerLng: number
): DeliveryEligibility {
  if (!restaurant.settings.deliveryEnabled) {
    return { eligible: false, reason: "This restaurant isn't offering delivery right now" };
  }
  if (restaurant.latitude == null || restaurant.longitude == null) {
    return { eligible: false, reason: "This restaurant hasn't set up its location for delivery yet" };
  }
  if (!restaurant.settings.deliveryRadiusKm) {
    return { eligible: false, reason: "This restaurant hasn't configured a delivery area yet" };
  }

  const distanceKm = haversineDistanceKm(restaurant.latitude, restaurant.longitude, customerLat, customerLng);
  const roundedDistanceKm = Math.round(distanceKm * 100) / 100;

  if (distanceKm > restaurant.settings.deliveryRadiusKm) {
    return { eligible: false, distanceKm: roundedDistanceKm, reason: "This address is outside the delivery area" };
  }

  return { eligible: true, distanceKm: roundedDistanceKm, deliveryFee: resolveDeliveryFee(restaurant.settings, roundedDistanceKm) };
}
