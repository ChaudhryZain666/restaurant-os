import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Paginated } from "@restaurant/types";
import { EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { IconSearch, IconUsers } from "../components/icons";
import type { CustomerHit } from "./types";

/**
 * A quick reference directory for front-of-house — the same GET /restaurants/:id/customers the
 * admin CustomersPage and the register's own CustomerPicker sheet use, so a cashier can look
 * someone up between the two without re-deriving anything, and jump straight into a new sale for
 * them.
 */
export function PosCustomersPage() {
  const restaurantId = useActiveLocationId();
  const { restaurant } = useRestaurantSettings();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [result, setResult] = useState<Paginated<CustomerHit> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 280);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    // See RegisterPage.tsx's identical guard.
    if (!restaurantId) return;
    setLoading(true);
    const params = new URLSearchParams({ page: "1", limit: "30" });
    if (debounced) params.set("search", debounced);
    apiClient
      .request<Paginated<CustomerHit>>(`/restaurants/${restaurantId}/customers?${params}`)
      .then((res) => {
        setResult(res);
        setError(null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId, debounced]);

  const currency = restaurant?.settings.currency ?? "USD";
  const customers = result?.items ?? [];

  return (
    <div className="flex h-full flex-col p-6">
      <h1 className="mb-4 font-heading text-2xl font-semibold text-foreground">Customers</h1>
      <div className="relative mb-4 max-w-md">
        <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, phone or email"
          className="h-11 w-full rounded-xl border border-border bg-surface pl-10 pr-3.5 text-sm text-foreground focus-visible:border-primary"
        />
      </div>

      {error && <EmptyState title="Couldn't load customers" description={error} />}

      {loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <EmptyState icon={<IconUsers className="h-6 w-6" />} title={debounced ? "No matching customers" : "No customers yet"} description={debounced ? "Try a different search." : "Customers appear here once they've ordered."} />
      ) : (
        <div className="grid grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <div key={c.customerId} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
                  {c.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="truncate text-xs text-muted">{c.phone ?? c.email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {c.totalOrders ?? 0} order{(c.totalOrders ?? 0) === 1 ? "" : "s"} · {formatCurrency(c.totalSpent ?? 0, currency)}
                </span>
              </div>
              <button
                onClick={() => navigate("/pos", { state: { customer: c } })}
                className="mt-1 self-start text-xs font-semibold text-primary hover:underline"
              >
                New sale for {c.name.split(" ")[0]}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
