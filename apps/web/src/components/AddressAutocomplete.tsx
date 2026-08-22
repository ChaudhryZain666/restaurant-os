import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";
import { apiClient } from "../lib/api";

interface AddressAutocompleteProps {
  placeholder?: string;
  /** Called with the server-resolved, provider-derived location — never anything the frontend
   *  invented itself. The consuming form decides what to do with formattedAddress/components. */
  onSelect: (result: GeocodeResult) => void;
  disabled?: boolean;
  /** Reset the visible search text (e.g. after the consuming form saves/cancels). */
  resetKey?: string | number;
}

/**
 * Debounced address search box, shared by AccountPage and CartPage (Phase 10). Talks only to this
 * app's own /geocoding/autocomplete + /geocoding/resolve endpoints — never a map/geocoding
 * provider directly, and never invents coordinates from whatever text the customer typed; a
 * result only ever comes back from resolving a suggestion the server actually returned.
 */
export function AddressAutocomplete({ placeholder = "Search for an address", onSelect, disabled, resetKey }: AddressAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against a slower earlier response landing after a faster later one — the debounce
  // timer alone only prevents firing a request per keystroke, not a stale response overwriting
  // fresher state once in flight (Part 13's "cancellation of stale autocomplete requests").
  const requestIdRef = useRef(0);

  useEffect(() => {
    setQuery("");
    setSuggestions([]);
    setOpen(false);
    setError(null);
  }, [resetKey]);

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
      onSelect(data.result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => (suggestions.length > 0 || error) && setOpen(true)}
        // A short delay lets a suggestion button's onClick register before the dropdown unmounts
        // on blur — without it, clicking a suggestion would close the list before the click fires.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={placeholder}
        disabled={disabled || resolving}
        aria-label={placeholder}
        className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
      />
      {(loading || resolving) && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">
          {resolving ? "Loading…" : "Searching…"}
        </span>
      )}
      {open && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-surface shadow-md" role="listbox">
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
  );
}
