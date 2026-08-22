import { env } from "../../config/env.js";
import { LocationIqProvider } from "./LocationIqProvider.js";
import { TestGeocodingProvider } from "./TestGeocodingProvider.js";
import type { GeocodingService } from "./types.js";

export { GeocodingError } from "./types.js";
export type { GeocodingContext, GeocodingErrorCode, GeocodingService } from "./types.js";
export type { AddressSuggestion, GeocodeAddressComponents, GeocodeResult } from "@restaurant/types";

let instance: GeocodingService | null = null;

/**
 * Lazy-singleton provider getter, mirroring email/index.ts and payments/index.ts: never throws at
 * boot, only when a route actually tries to use geocoding without it being configured. See
 * docs/delivery-architecture.md for why LocationIQ was chosen as the real provider, and what
 * GEOCODING_PROVIDER=test is for.
 */
export function getGeocodingService(): GeocodingService {
  if (instance) return instance;

  if (env.GEOCODING_PROVIDER === "locationiq") {
    if (!env.GEOCODING_API_KEY) {
      throw new Error("GEOCODING_PROVIDER=locationiq requires GEOCODING_API_KEY to be set.");
    }
    instance = new LocationIqProvider(env.GEOCODING_API_KEY, env.GEOCODING_BASE_URL);
    return instance;
  }

  if (env.GEOCODING_PROVIDER === "test") {
    instance = new TestGeocodingProvider();
    return instance;
  }

  throw new Error(
    "Geocoding is not configured. Set GEOCODING_PROVIDER=locationiq (with GEOCODING_API_KEY) for real address " +
      "lookup, or GEOCODING_PROVIDER=test for a deterministic offline provider suitable for local dev/CI."
  );
}

/** Test-only reset — Jest's module registry is shared within a worker, so without this, a test
 *  file that imports after another has already called getGeocodingService() would silently reuse
 *  that earlier instance instead of picking up its own env/mock setup. */
export function resetGeocodingServiceForTests(): void {
  instance = null;
}
