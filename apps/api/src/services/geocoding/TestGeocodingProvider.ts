import { GeocodingError, type GeocodingService } from "./types.js";
import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";

/**
 * Deterministic, offline GeocodingService — no network call, no API key, same result every time
 * for the same input. This is a real, selectable adapter (GEOCODING_PROVIDER=test), not a test
 * double that bypasses the GeocodingService boundary: controllers/UI talk to it through the exact
 * same interface LocationIqProvider implements. It exists so this repo's Jest/Playwright suites
 * (and any environment without real LocationIQ credentials) can exercise the full
 * autocomplete → resolve → delivery-eligibility flow without depending on a live third-party
 * service being reachable — see docs/delivery-architecture.md.
 *
 * The fixture coordinates deliberately match the ones Phase 9's delivery tests already use (near
 * demo-restaurant, and clearly outside its radius), so this provider's results stay consistent
 * with those existing eligibility-boundary expectations.
 */
const FIXTURES: (GeocodeResult & { keywords: string[] })[] = [
  {
    keywords: ["1200", "6th", "springfield", "62703"],
    formattedAddress: "1200 S 6th St, Springfield, IL 62703, USA",
    latitude: 39.7658,
    longitude: -89.6501,
    components: { line1: "1200 S 6th St", city: "Springfield", state: "IL", postalCode: "62703", country: "USA", countryCode: "US" },
  },
  {
    keywords: ["wacker", "chicago", "60606"],
    formattedAddress: "233 S Wacker Dr, Chicago, IL 60606, USA",
    latitude: 41.8781,
    longitude: -87.6298,
    components: { line1: "233 S Wacker Dr", city: "Chicago", state: "IL", postalCode: "60606", country: "USA", countryCode: "US" },
  },
  {
    keywords: ["congress", "austin", "78701"],
    formattedAddress: "200 Congress Ave, Austin, TX 78701, USA",
    latitude: 30.27,
    longitude: -97.75,
    components: { line1: "200 Congress Ave", city: "Austin", state: "TX", postalCode: "78701", country: "USA", countryCode: "US" },
  },
  {
    keywords: ["bella vista", "boston", "02108"],
    formattedAddress: "1 Bella Vista Way, Boston, MA 02108, USA",
    latitude: 42.3601,
    longitude: -71.0589,
    components: { line1: "1 Bella Vista Way", city: "Boston", state: "MA", postalCode: "02108", country: "USA", countryCode: "US" },
  },
];

/** A magic query prefix Jest controller/integration tests use to exercise the provider_error path
 *  without needing to stand up a real failing HTTP server. */
const PROVIDER_ERROR_TRIGGER = "provider_error_test";

let counter = 0;

export class TestGeocodingProvider implements GeocodingService {
  private readonly resolved = new Map<string, GeocodeResult>();

  async geocode(query: string): Promise<GeocodeResult> {
    const trimmed = query.trim();
    if (trimmed.length < 3) throw new GeocodingError("invalid_input", "Enter at least 3 characters to search.");
    if (trimmed.toLowerCase().includes(PROVIDER_ERROR_TRIGGER)) {
      throw new GeocodingError("provider_error", "Simulated provider failure.");
    }

    const match = this.findMatch(trimmed);
    if (!match) throw new GeocodingError("no_results", "No matching address was found.");
    return this.stripKeywords(match);
  }

  async autocomplete(query: string): Promise<AddressSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];
    if (trimmed.toLowerCase().includes(PROVIDER_ERROR_TRIGGER)) {
      throw new GeocodingError("provider_error", "Simulated provider failure.");
    }

    const q = trimmed.toLowerCase();
    const matches = FIXTURES.filter((f) => f.keywords.some((k) => k.includes(q) || q.includes(k)));
    return matches.map((f) => {
      const id = `test-suggestion-${counter++}`;
      this.resolved.set(id, this.stripKeywords(f));
      return { id, label: f.formattedAddress };
    });
  }

  async resolveSuggestion(suggestionId: string): Promise<GeocodeResult> {
    const cached = this.resolved.get(suggestionId);
    if (!cached) throw new GeocodingError("no_results", "That suggestion has expired — please search again.");
    return cached;
  }

  private findMatch(query: string): (GeocodeResult & { keywords: string[] }) | null {
    const q = query.toLowerCase();
    return FIXTURES.find((f) => f.keywords.some((k) => k.includes(q) || q.includes(k))) ?? null;
  }

  private stripKeywords(fixture: GeocodeResult & { keywords: string[] }): GeocodeResult {
    const { keywords: _keywords, ...result } = fixture;
    return result;
  }
}
