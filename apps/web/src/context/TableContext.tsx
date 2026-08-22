import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useMatch } from "react-router-dom";
import type { ResolvedTable } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useRestaurant } from "./RestaurantContext";

// Persisted so a customer who scans the QR, browses the menu, then taps through to /cart (a real
// navigation, not the same page) doesn't lose their table context. Session-scoped, not
// permanent — a fresh tab/visit shouldn't silently inherit a table from a previous visit.
// Phase 8: keyed by restaurantId, not just the token — a customer can browse multiple
// restaurants in the same tab (different /r/:slug routes), and a table token stored while
// browsing Restaurant A must never be tried against Restaurant B.
const STORAGE_KEY = "dineIn.tableToken";

interface StoredToken {
  restaurantId: string;
  token: string;
}

function readStoredToken(restaurantId: string): string | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    return parsed.restaurantId === restaurantId ? parsed.token : null;
  } catch {
    return null;
  }
}

function writeStoredToken(restaurantId: string, token: string | null) {
  try {
    if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ restaurantId, token } satisfies StoredToken));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage can be unavailable (private browsing, embedded webviews) — table context
    // simply won't survive a full navigation in that case, it still works within the page.
  }
}

interface TableContextValue {
  /** Non-null only once the token has been successfully re-resolved server-side. */
  table: ResolvedTable | null;
  /** The token backing `table` — never trust any other value for checkout; null until resolved. */
  tableToken: string | null;
  loading: boolean;
  error: string | null;
  clearTable: () => void;
}

const TableContext = createContext<TableContextValue | undefined>(undefined);

export function TableProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useRestaurant();
  const slugMatch = useMatch("/r/:restaurantSlug/t/:tableToken");
  // Phase 22 — a custom domain renders MenuPage directly at the bare "/t/:tableToken" route (see
  // App.tsx's LegacyRedirect), with no "/r/:slug" segment ever in the URL, so table resolution
  // needs the same dual-mode match RestaurantContext already uses for restaurant identity.
  const bareMatch = useMatch("/t/:tableToken");
  const urlToken = slugMatch?.params.tableToken ?? bareMatch?.params.tableToken ?? null;

  const [table, setTable] = useState<ResolvedTable | null>(null);
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurant) return;
    // A fresh QR scan (URL token) always wins — e.g. a customer moves tables mid-visit and
    // rescans. Otherwise fall back to a stored token, but only if it was stored for THIS
    // restaurant; a token left over from browsing a different restaurant earlier in the same tab
    // must never be tried here.
    const tokenToTry = urlToken ?? readStoredToken(restaurant.id);
    if (!tokenToTry) {
      setTable(null);
      setResolvedToken(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    apiClient
      .request<{ table: ResolvedTable }>(`/restaurants/${restaurant.id}/tables/resolve/${tokenToTry}`, {
        skipRefresh: true,
      })
      .then((data) => {
        if (cancelled) return;
        setTable(data.table);
        setResolvedToken(tokenToTry);
        writeStoredToken(restaurant.id, tokenToTry);
      })
      .catch((err) => {
        if (cancelled) return;
        setTable(null);
        setResolvedToken(null);
        // Only surface an error banner for an actual QR scan gone bad — a stale/invalid stored
        // token silently falling through isn't something the customer did just now.
        if (urlToken) setError((err as Error).message);
        writeStoredToken(restaurant.id, null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [restaurant, urlToken]);

  function clearTable() {
    setTable(null);
    setResolvedToken(null);
    setError(null);
    if (restaurant) writeStoredToken(restaurant.id, null);
  }

  return (
    <TableContext.Provider value={{ table, tableToken: table ? resolvedToken : null, loading, error, clearTable }}>
      {children}
    </TableContext.Provider>
  );
}

export function useTable() {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error("useTable must be used within TableProvider");
  return ctx;
}
