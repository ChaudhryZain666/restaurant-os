/** Structured pieces of a geocoded address, when the provider can break them out — never
 *  guaranteed present, since not every provider/result returns every component. */
export interface GeocodeAddressComponents {
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
}

/** Normalized geocoding result — the same shape regardless of which provider produced it (see
 *  apps/api/src/services/geocoding/ for the provider-agnostic boundary this mirrors). */
export interface GeocodeResult {
  formattedAddress: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  components?: GeocodeAddressComponents;
}

/** One autocomplete suggestion — deliberately minimal (just enough to display and to resolve via
 *  GET /geocoding/resolve/:id). Never carries coordinates directly: those come from resolving the
 *  suggestion server-side, not from anything the client already has. */
export interface AddressSuggestion {
  id: string;
  label: string;
}
