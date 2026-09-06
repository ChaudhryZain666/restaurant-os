import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";
import { apiClient } from "../../lib/api";
import type { PosDeliveryAddress } from "../types";

const inputClass = "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground";

function toPosDeliveryAddress(result: GeocodeResult): PosDeliveryAddress {
  return {
    line1: result.components?.line1 || result.formattedAddress,
    city: result.components?.city || "",
    state: result.components?.state,
    postalCode: result.components?.postalCode,
    country: result.components?.country,
    latitude: result.latitude,
    longitude: result.longitude,
  };
}

/**
 * Phase 47 — the actual fix for POS delivery orders hardcoding latitude/longitude to (0, 0):
 * this is where a real address, with real coordinates, actually comes from. Mirrors apps/web's
 * AddressAutocomplete (same debounced /geocoding/autocomplete -> /geocoding/resolve/:id flow,
 * same "never invent coordinates from typed text" rule) rather than duplicating any delivery
 * calculation — this component only ever produces an address; checkDeliveryEligibility
 * (delivery.service.ts) still runs server-side inside createOrderForCustomer exactly as it does
 * for the customer-facing checkout. Deliberately offers no manual latitude/longitude entry: POS
 * staff pick a real suggestion or the order can't proceed, never a raw coordinate a cashier would
 * have to understand.
 */
export function DeliveryAddressSearch({
  value,
  onChange,
  disabled,
}: {
  value: PosDeliveryAddress | null;
  onChange: (address: PosDeliveryAddress | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a slower earlier response landing after a faster later one, same reasoning as
  // AddressAutocomplete's identical ref.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const thisRequestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      apiClient
        .request<{ suggestions: AddressSuggestion[] }>(`/geocoding/autocomplete?q=${encodeURIComponent(trimmed)}`)
        .then((data) => {
          if (requestIdRef.current !== thisRequestId) return;
          setSuggestions(data.suggestions);
          setError(null);
          setOpen(true);
        })
        .catch((err) => {
          if (requestIdRef.current !== thisRequestId) return;
          setSuggestions([]);
          setError((err as Error).message);
          setOpen(true);
        })
        .finally(() => {
          if (requestIdRef.current === thisRequestId) setLoading(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [query]);

  async function selectSuggestion(suggestion: AddressSuggestion) {
    setResolving(true);
    setError(null);
    try {
      const data = await apiClient.request<{ result: GeocodeResult }>(`/geocoding/resolve/${encodeURIComponent(suggestion.id)}`);
      setQuery(data.result.formattedAddress);
      setSuggestions([]);
      setOpen(false);
      onChange(toPosDeliveryAddress(data.result));
    } catch (err) {
      setError((err as Error).message);
      onChange(null);
    } finally {
      setResolving(false);
    }
  }

  function handleQueryChange(next: string) {
    setQuery(next);
    // Any manual edit invalidates whatever was previously resolved — a stale, no-longer-matching
    // set of coordinates must never ride along with new, unresolved text.
    if (value) onChange(null);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onFocus={() => (suggestions.length > 0 || error) && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Search for the delivery address…"
          disabled={disabled || resolving}
          aria-label="Delivery address"
          className={`w-full ${inputClass}`}
        />
        {(loading || resolving) && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">
            {resolving ? "Loading…" : "Searching…"}
          </span>
        )}
        {open && (
          <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-surface shadow-md" role="listbox">
            {error ? (
              <p className="px-3 py-2 text-sm text-danger">{error}</p>
            ) : suggestions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted">{loading ? "Searching…" : "No matching address found."}</p>
            ) : (
              <ul>
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => selectSuggestion(s)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/[0.03]"
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {value ? (
        <p className="text-xs text-success">Address confirmed — {value.line1}, {value.city}</p>
      ) : (
        <p className="text-xs text-muted">Search and select a real address — required to check delivery eligibility.</p>
      )}
    </div>
  );
}
