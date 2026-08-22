import { useEffect, useRef, useState } from "react";
import type { AddressSuggestion, GeocodeResult } from "@restaurant/types";
import { apiClient } from "../lib/api";

interface AddressAutocompleteProps {
  placeholder?: string;
  /** Called with the server-resolved, provider-derived location — never anything the frontend
   *  invented itself. The consuming form decides what to do with formattedAddress/components. */
  onSelect: (result: GeocodeResult) => void;
  disabled?: boolean;
}

/**
 * Debounced address search box for the restaurant location picker (Settings → Location). Mirrors
 * apps/web/src/components/AddressAutocomplete.tsx — kept as a separate copy rather than a shared
 * package since apps/web and apps/admin are independent Vite apps with their own apiClient
 * instances, and each only has one real consumer of this component today.
 */
export function AddressAutocomplete({ placeholder = "Search for an address", onSelect, disabled }: AddressAutocompleteProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder={placeholder}
        disabled={disabled || resolving}
        aria-label={placeholder}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
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
