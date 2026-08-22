import type { Request, Response } from "express";
import type { AutocompleteQueryInput, GeocodeInput } from "@restaurant/validation";
import { getGeocodingService, GeocodingError, type GeocodingErrorCode } from "../services/geocoding/index.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";

// The customer/admin never sees a raw provider exception, API key, or internal response detail —
// only one of these fixed, friendly strings (Part 5 of the Phase 10 brief). The real error and
// its code are still logged server-side for operators to actually debug.
const FRIENDLY_MESSAGE: Record<GeocodingErrorCode, string> = {
  not_configured: "Address lookup isn't available right now.",
  invalid_input: "Enter at least 3 characters to search.",
  no_results: "No matching address was found.",
  rate_limited: "Too many address lookups right now — please wait a moment and try again.",
  provider_error: "Unable to find that address right now. Please try again.",
  timeout: "Unable to find that address right now. Please try again.",
};

function handleGeocodingError(err: unknown): never {
  if (err instanceof GeocodingError) {
    console.error(`[geocoding] ${err.code}: ${err.message}`);
    const message = FRIENDLY_MESSAGE[err.code];
    if (err.code === "invalid_input") throw ApiError.badRequest(message);
    if (err.code === "no_results") throw ApiError.notFound(message);
    if (err.code === "rate_limited") throw ApiError.tooManyRequests(message);
    throw ApiError.serviceUnavailable(message);
  }
  throw err;
}

export async function autocompleteAddress(req: Request, res: Response) {
  const { q, countryCode } = req.query as unknown as AutocompleteQueryInput;
  try {
    const suggestions = await getGeocodingService().autocomplete(q, countryCode ? { countryCode } : undefined);
    sendSuccess(res, { suggestions });
  } catch (err) {
    handleGeocodingError(err);
  }
}

export async function resolveAddressSuggestion(req: Request, res: Response) {
  try {
    const result = await getGeocodingService().resolveSuggestion(req.params.suggestionId);
    sendSuccess(res, { result });
  } catch (err) {
    handleGeocodingError(err);
  }
}

export async function geocodeAddress(req: Request, res: Response) {
  const { query, countryCode } = req.body as GeocodeInput;
  try {
    const result = await getGeocodingService().geocode(query, countryCode ? { countryCode } : undefined);
    sendSuccess(res, { result });
  } catch (err) {
    handleGeocodingError(err);
  }
}
