import { z } from "zod";

// Input length capped well below anything a real address needs — prevents a client from sending
// an absurdly long string through to the provider (see delivery-architecture.md's rate-limiting
// section for the other half of this protection, the per-route request limiter).
const addressQuery = z.string().trim().min(1).max(200);
const countryCode = z.string().length(2).optional();

export const autocompleteQuerySchema = z.object({
  q: addressQuery,
  countryCode,
});
export type AutocompleteQueryInput = z.infer<typeof autocompleteQuerySchema>;

export const geocodeSchema = z.object({
  query: addressQuery,
  countryCode,
});
export type GeocodeInput = z.infer<typeof geocodeSchema>;

export const resolveSuggestionParamsSchema = z.object({
  suggestionId: z.string().trim().min(1).max(200),
});
export type ResolveSuggestionParams = z.infer<typeof resolveSuggestionParamsSchema>;
