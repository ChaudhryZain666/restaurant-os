import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import type { KnowledgeBaseArticle } from "@restaurant/types";
import { Button, Card, Spinner } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";

/**
 * Maps the current route to a search query so the widget can prioritize relevant articles
 * without the user typing anything — e.g. opening the widget on /cart surfaces checkout help.
 * A small static table is enough for this phase's route set; if this grows unwieldy once more
 * pages exist, move it to a per-route metadata field instead of a lookup table.
 */
const ROUTE_HELP_QUERY: Record<string, string> = {
  "/": "menu ordering",
  "/cart": "checkout order type delivery",
  "/orders": "order status tracking",
  "/account": "profile address",
  "/loyalty": "loyalty points",
};

/** Strips a leading /r/:restaurantSlug segment so the lookup table above doesn't need a
 *  restaurant-scoped duplicate of every entry — /r/spice-route/cart matches "/cart" the same way
 *  the legacy bare /cart route always has. */
function normalizedPathname(pathname: string): string {
  const restaurantScoped = pathname.match(/^\/r\/[^/]+(\/.*)?$/);
  if (!restaurantScoped) return pathname;
  return restaurantScoped[1] ?? "/";
}

function suggestedQueryFor(pathname: string): string | null {
  const normalized = normalizedPathname(pathname);
  if (ROUTE_HELP_QUERY[normalized]) return ROUTE_HELP_QUERY[normalized];
  const prefixMatch = Object.keys(ROUTE_HELP_QUERY).find((p) => p !== "/" && normalized.startsWith(p));
  return prefixMatch ? ROUTE_HELP_QUERY[prefixMatch] : null;
}

function HelpGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className} aria-hidden>
      <path d="M9.5 9a2.5 2.5 0 1 1 3.4 2.33c-.72.27-1.4.9-1.4 1.67v.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="17.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export function HelpWidget() {
  const { user } = useAuth();
  const { supportIdentity } = useRestaurant();
  const location = useLocation();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeBaseArticle[]>([]);
  const [loading, setLoading] = useState(false);

  const suggestedQuery = suggestedQueryFor(location.pathname);

  useEffect(() => {
    if (!open) return;
    const q = query || suggestedQuery;
    if (!q) {
      setResults([]);
      return;
    }
    setLoading(true);
    apiClient
      .request<{ articles: KnowledgeBaseArticle[] }>(`/kb/articles?q=${encodeURIComponent(q)}`)
      .then((data) => setResults(data.articles.slice(0, 4)))
      .finally(() => setLoading(false));
  }, [open, query, suggestedQuery]);

  function goToArticle(slug: string) {
    setOpen(false);
    navigate(`/support/articles/${slug}`);
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 sm:bottom-6 sm:right-6">
      {open && (
        <Card className="animate-scale-in mb-3 flex w-[calc(100vw-2.5rem)] max-w-80 flex-col gap-3 shadow-elevated">
          <div className="flex items-center justify-between">
            <h2 className="font-heading font-medium text-foreground">{supportIdentity?.name ?? "Help"}</h2>
            <button onClick={() => setOpen(false)} aria-label="Close help" className="text-muted hover:text-foreground">
              ✕
            </button>
          </div>

          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for help..."
            className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm"
          />

          <div className="flex flex-col gap-1">
            {loading ? (
              <Spinner size="sm" label="Searching" />
            ) : results.length > 0 ? (
              <>
                <p className="text-xs uppercase tracking-wide text-muted">{query ? "Results" : "Suggested for this page"}</p>
                {results.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => goToArticle(a.slug)}
                    className="rounded-md px-2 py-1.5 text-left text-sm text-foreground/90 transition-colors duration-fast hover:bg-black/[0.04]"
                  >
                    {a.title}
                  </button>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted">No suggestions yet — try searching, or contact us below.</p>
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-2">
            <Link to="/support" onClick={() => setOpen(false)} className="text-sm font-medium text-primary hover:opacity-80">
              Browse help center
            </Link>
            <Button
              size="sm"
              onClick={() => {
                setOpen(false);
                navigate("/support/tickets/new");
              }}
            >
              Contact {supportIdentity?.name ?? "support"}
            </Button>
            {user && (
              <Link
                to="/support/tickets"
                onClick={() => setOpen(false)}
                className="text-sm font-medium text-muted hover:text-foreground"
              >
                View my tickets
              </Link>
            )}
          </div>
        </Card>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close help widget" : "Open help widget"}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition-transform duration-fast ease-premium hover:scale-105 active:scale-95"
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        ) : (
          <HelpGlyph className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
