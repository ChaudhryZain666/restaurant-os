import { redis } from "../../config/redis.js";
import { GeocodingError, type GeocodingContext, type GeocodingService } from "./types.js";
import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";

const DEFAULT_BASE_URL = "https://api.locationiq.com/v1";
const REQUEST_TIMEOUT_MS = 5_000;
const AUTOCOMPLETE_LIMIT = 5;

// A resolved suggestion is cached under its own id — LocationIQ's autocomplete response already
// includes coordinates per result, so resolveSuggestion() is served straight out of this cache
// rather than issuing a second provider request. 10 minutes is long enough to cover "search, look
// at the dropdown, pick one" and short enough that a stale/expired id just means "search again",
// never a wrong location silently reused. See docs/delivery-architecture.md's caching section.
const SUGGESTION_CACHE_TTL_SECONDS = 10 * 60;
// A one-shot geocode() of the same address text repeats the identical provider call for the
// identical answer — cached for a day. This is a performance/cost cache, not a data store: it's
// keyed by normalized query text only (no customerId, no order/account linkage), and expires on
// its own; the customer's actual saved address still lives solely in User.addresses.
const GEOCODE_CACHE_TTL_SECONDS = 24 * 60 * 60;

interface LocationIqAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  postcode?: string;
  country?: string;
  country_code?: string;
}

interface LocationIqPlace {
  place_id: string;
  lat: string;
  lon: string;
  display_name: string;
  address?: LocationIqAddress;
}

function suggestionCacheKey(id: string): string {
  return `geocoding:suggestion:${id}`;
}

function geocodeCacheKey(normalizedQuery: string): string {
  return `geocoding:geocode:${normalizedQuery}`;
}

function normalizeQuery(query: string, context?: GeocodingContext): string {
  return `${query.trim().toLowerCase().replace(/\s+/g, " ")}|${context?.countryCode?.toLowerCase() ?? ""}`;
}

/** Maps LocationIQ's raw place shape to this codebase's normalized GeocodeResult — the only place
 *  in the application that ever reads LocationIQ-specific field names. */
function mapPlace(place: LocationIqPlace): GeocodeResult {
  const line1 = [place.address?.house_number, place.address?.road].filter(Boolean).join(" ");
  return {
    formattedAddress: place.display_name,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    placeId: place.place_id,
    components: place.address
      ? {
          line1: line1 || undefined,
          city: place.address.city ?? place.address.town ?? place.address.village,
          state: place.address.state,
          postalCode: place.address.postcode,
          country: place.address.country,
          countryCode: place.address.country_code?.toUpperCase(),
        }
      : undefined,
  };
}

/**
 * Real, working adapter against LocationIQ's REST API (forward geocoding: /search, autocomplete:
 * /autocomplete — see docs/delivery-architecture.md for why LocationIQ was chosen). Server-side
 * only: the API key is never sent to or read by the browser, matching PaymentProvider/EmailService's
 * existing secret-handling pattern in this codebase.
 */
export class LocationIqProvider implements GeocodingService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL
  ) {}

  private async request(path: string, params: Record<string, string>): Promise<LocationIqPlace[]> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("format", "json");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new GeocodingError("timeout", "The location lookup provider timed out.");
      }
      throw new GeocodingError("provider_error", `Could not reach the location lookup provider: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401 || res.status === 403) {
      throw new GeocodingError("not_configured", "The location lookup provider rejected our credentials.");
    }
    if (res.status === 429) {
      throw new GeocodingError("rate_limited", "The location lookup provider is rate-limiting us right now.");
    }
    // LocationIQ returns 404 with {"error":"Unable to geocode"} for "no matches" — not a real
    // failure, just an empty result set.
    if (res.status === 404) return [];
    if (!res.ok) {
      throw new GeocodingError("provider_error", `Location lookup provider returned HTTP ${res.status}.`);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new GeocodingError("provider_error", "Location lookup provider returned an unreadable response.");
    }
    if (!Array.isArray(body)) {
      // A single-object error payload (e.g. {"error":"..."}) rather than the expected array.
      return [];
    }
    return body as LocationIqPlace[];
  }

  async geocode(query: string, context?: GeocodingContext): Promise<GeocodeResult> {
    const trimmed = query.trim();
    if (trimmed.length < 3) throw new GeocodingError("invalid_input", "Enter at least 3 characters to search.");

    const cacheKey = geocodeCacheKey(normalizeQuery(trimmed, context));
    const cached = await redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as GeocodeResult;

    const params: Record<string, string> = { q: trimmed, addressdetails: "1", limit: "1" };
    if (context?.countryCode) params.countrycodes = context.countryCode.toLowerCase();

    const places = await this.request("/search", params);
    if (places.length === 0) throw new GeocodingError("no_results", "No matching address was found.");

    const result = mapPlace(places[0]);
    await redis.set(cacheKey, JSON.stringify(result), "EX", GEOCODE_CACHE_TTL_SECONDS).catch(() => {});
    return result;
  }

  async autocomplete(query: string, context?: GeocodingContext): Promise<AddressSuggestion[]> {
    const trimmed = query.trim();
    if (trimmed.length < 3) return [];

    const params: Record<string, string> = { q: trimmed, limit: String(AUTOCOMPLETE_LIMIT) };
    if (context?.countryCode) params.countrycodes = context.countryCode.toLowerCase();

    const places = await this.request("/autocomplete", params);

    const suggestions: AddressSuggestion[] = [];
    for (const place of places) {
      const result = mapPlace(place);
      suggestions.push({ id: place.place_id, label: result.formattedAddress });
      // Best-effort: if Redis is briefly unavailable, the suggestion still displays — only
      // resolving it later would fail (as "expired"), which is an honest, recoverable outcome.
      await redis.set(suggestionCacheKey(place.place_id), JSON.stringify(result), "EX", SUGGESTION_CACHE_TTL_SECONDS).catch(() => {});
    }
    return suggestions;
  }

  async resolveSuggestion(suggestionId: string): Promise<GeocodeResult> {
    const cached = await redis.get(suggestionCacheKey(suggestionId)).catch(() => null);
    if (!cached) {
      throw new GeocodingError("no_results", "That suggestion has expired — please search again.");
    }
    return JSON.parse(cached) as GeocodeResult;
  }
}
