import { describe, expect, it } from "@jest/globals";
import { checkDeliveryEligibility, haversineDistanceKm } from "./delivery.service.js";

const EXACT_DISTANCE_ZERO_TO_ONE_DEGREE = haversineDistanceKm(0, 0, 0, 1);

describe("haversineDistanceKm", () => {
  it("is zero for identical coordinates", () => {
    expect(haversineDistanceKm(39.7817, -89.6501, 39.7817, -89.6501)).toBe(0);
  });

  it("computes a known distance (1 degree of longitude at the equator is ~111.2km)", () => {
    expect(haversineDistanceKm(0, 0, 0, 1)).toBeCloseTo(111.19, 1);
  });

  it("is symmetric", () => {
    const a = haversineDistanceKm(39.7817, -89.6501, 39.7658, -89.6501);
    const b = haversineDistanceKm(39.7658, -89.6501, 39.7817, -89.6501);
    expect(a).toBeCloseTo(b, 10);
  });
});

function restaurant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    settings: {
      deliveryEnabled: true,
      deliveryFee: 3.99,
      deliveryRadiusKm: 8,
    },
    latitude: 39.7817,
    longitude: -89.6501,
    ...overrides,
  } as Parameters<typeof checkDeliveryEligibility>[0];
}

describe("checkDeliveryEligibility", () => {
  it("is ineligible when the restaurant hasn't enabled delivery", () => {
    const result = checkDeliveryEligibility(
      restaurant({ settings: { deliveryEnabled: false, deliveryFee: 3.99, deliveryRadiusKm: 8 } }),
      39.7817,
      -89.6501
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.distanceKm).toBeUndefined();
  });

  it("is ineligible when the restaurant has no coordinates configured", () => {
    const result = checkDeliveryEligibility(restaurant({ latitude: undefined, longitude: undefined }), 39.7817, -89.6501);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("is ineligible when only one of latitude/longitude is set", () => {
    const result = checkDeliveryEligibility(restaurant({ longitude: undefined }), 39.7817, -89.6501);
    expect(result.eligible).toBe(false);
  });

  it("is ineligible when no delivery radius has been configured", () => {
    const result = checkDeliveryEligibility(
      restaurant({ settings: { deliveryEnabled: true, deliveryFee: 3.99, deliveryRadiusKm: undefined } }),
      39.7817,
      -89.6501
    );
    expect(result.eligible).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("is eligible for a customer well within the radius, returning distance and the restaurant's fee", () => {
    // ~1.77km from the restaurant (well within 8km)
    const result = checkDeliveryEligibility(restaurant(), 39.7658, -89.6501);
    expect(result.eligible).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(8);
    expect(result.deliveryFee).toBe(3.99);
    expect(result.reason).toBeUndefined();
  });

  it("is ineligible for a customer outside the radius, still reporting the computed distance", () => {
    // Far outside 8km (Austin, TX from Springfield, IL)
    const result = checkDeliveryEligibility(restaurant(), 30.2672, -97.7431);
    expect(result.eligible).toBe(false);
    expect(result.distanceKm).toBeGreaterThan(8);
    expect(result.deliveryFee).toBeUndefined();
    expect(result.reason).toBeTruthy();
  });

  it("treats a distance exactly equal to the radius as eligible (not strictly less-than)", () => {
    const result = checkDeliveryEligibility(
      restaurant({
        latitude: 0,
        longitude: 0,
        settings: { deliveryEnabled: true, deliveryFee: 2, deliveryRadiusKm: EXACT_DISTANCE_ZERO_TO_ONE_DEGREE },
      }),
      0,
      1
    );
    expect(result.eligible).toBe(true);
  });

  it("rounds the reported distance to 2 decimal places", () => {
    const result = checkDeliveryEligibility(restaurant(), 39.7658, -89.6501);
    expect(result.distanceKm).toBe(Math.round((result.distanceKm ?? 0) * 100) / 100);
  });

  it("never returns a fee different from the restaurant's own configured deliveryFee", () => {
    const result = checkDeliveryEligibility(restaurant({ settings: { deliveryEnabled: true, deliveryFee: 7.25, deliveryRadiusKm: 8 } }), 39.7658, -89.6501);
    expect(result.deliveryFee).toBe(7.25);
  });

  describe("Phase 28 — distance-tiered pricing", () => {
    function tieredRestaurant() {
      return restaurant({
        settings: {
          deliveryEnabled: true,
          deliveryFee: 9.99, // flat fallback — should never be used once tiers are configured
          deliveryRadiusKm: 10,
          deliveryFeeTiers: [
            { maxDistanceKm: 2, fee: 1.5 },
            { maxDistanceKm: 5, fee: 3.5 },
            { maxDistanceKm: 10, fee: 6 },
          ],
        },
      });
    }

    it("charges the tightest-fitting tier for a short-distance order", () => {
      // ~1.77km — falls within the 2km tier
      const result = checkDeliveryEligibility(tieredRestaurant(), 39.7658, -89.6501);
      expect(result.eligible).toBe(true);
      expect(result.deliveryFee).toBe(1.5);
    });

    it("charges the correct tier for a mid-distance order, never the tighter tier below it", () => {
      // ~3.98km — outside the 2km tier, within the 5km tier
      const result = checkDeliveryEligibility(tieredRestaurant(), 39.7458, -89.6501);
      expect(result.eligible).toBe(true);
      expect(result.deliveryFee).toBe(3.5);
    });

    it("falls back to the flat deliveryFee when deliveryFeeTiers is empty", () => {
      const result = checkDeliveryEligibility(restaurant({ settings: { deliveryEnabled: true, deliveryFee: 4.25, deliveryRadiusKm: 8, deliveryFeeTiers: [] } }), 39.7658, -89.6501);
      expect(result.deliveryFee).toBe(4.25);
    });

    it("tier entry order never matters — the tightest-fitting tier wins regardless of array order", () => {
      const shuffled = restaurant({
        settings: {
          deliveryEnabled: true,
          deliveryFee: 9.99,
          deliveryRadiusKm: 10,
          deliveryFeeTiers: [
            { maxDistanceKm: 10, fee: 6 },
            { maxDistanceKm: 2, fee: 1.5 },
            { maxDistanceKm: 5, fee: 3.5 },
          ],
        },
      });
      const result = checkDeliveryEligibility(shuffled, 39.7658, -89.6501);
      expect(result.deliveryFee).toBe(1.5);
    });
  });
});
