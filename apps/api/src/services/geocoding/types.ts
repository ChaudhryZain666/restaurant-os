import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";

export type { AddressSuggestion, GeocodeAddressComponents, GeocodeResult } from "@restaurant/types";

export interface GeocodingContext {
  /** ISO 3166-1 alpha-2 country code (e.g. "PK", "US") — narrows results when the customer's
   *  country is already known, never required. */
  countryCode?: string;
}

export type GeocodingErrorCode =
  | "not_configured"
  | "invalid_input"
  | "no_results"
  | "rate_limited"
  | "provider_error"
  | "timeout";

/** Every failure mode a provider adapter can hit, normalized to one of a small set of codes the
 *  controller maps to a safe, generic customer-facing message — never the raw provider
 *  exception/response (see geocoding.controller.ts). */
export class GeocodingError extends Error {
  readonly code: GeocodingErrorCode;
  constructor(code: GeocodingErrorCode, message: string) {
    super(message);
    this.name = "GeocodingError";
    this.code = code;
  }
}

/**
 * Provider-agnostic address lookup boundary. The rest of the application (controllers, React
 * components, the Order/Address models) only ever knows about GeocodeResult/AddressSuggestion —
 * provider-specific response fields are mapped away inside the adapter (see LocationIqProvider.ts)
 * and never leak past this interface.
 *
 * autocomplete() + resolveSuggestion() model the two-step flow some providers require (search →
 * pick a suggestion → fetch its full details); a provider whose autocomplete response already
 * includes coordinates (like LocationIQ's) can just cache them from the first call and serve
 * resolveSuggestion() out of that cache, without a second HTTP round-trip — see
 * docs/delivery-architecture.md's caching section.
 */
export interface GeocodingService {
  /** One-shot forward geocode of a full address string — used for a typed, non-interactive lookup
   *  (e.g. an admin pasting a complete address) rather than an autocomplete selection. */
  geocode(query: string, context?: GeocodingContext): Promise<GeocodeResult>;
  autocomplete(query: string, context?: GeocodingContext): Promise<AddressSuggestion[]>;
  resolveSuggestion(suggestionId: string): Promise<GeocodeResult>;
}
