import { Fragment, useEffect, useState } from "react";
import type { Order, Paginated, RestaurantCustomerSummary } from "@restaurant/types";
import { Alert, Badge, Card, EmptyState, Pagination } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRestaurantCurrency } from "../hooks/useRestaurantCurrency";
import { STATUS_LABELS, STATUS_TONE } from "../lib/orderStatusFlow";

const PAGE_SIZE = 20;
const ORDERS_PAGE_SIZE = 10;

function CustomerOrdersRow({ restaurantId, customerId }: { restaurantId: string; customerId: string }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Order> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(ORDERS_PAGE_SIZE) });
    apiClient
      .request<Paginated<Order>>(`/restaurants/${restaurantId}/customers/${customerId}/orders?${params}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId, customerId, page]);

  const orders = result?.items ?? [];

  return (
    <tr>
      <td colSpan={5} className="bg-black/[0.02] px-4 py-3">
        {error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : loading ? (
          <p className="text-sm text-muted">Loading orders...</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted">No orders found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col divide-y divide-border">
              {orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="font-medium text-foreground">{o.orderNumber}</span>
                  <span className="text-muted">{new Date(o.createdAt).toLocaleString()}</span>
                  <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                  <span className="text-foreground">{formatCurrency(o.total, o.currency)}</span>
                </li>
              ))}
            </ul>
            {result && result.totalPages > 1 && (
              <Pagination
                page={result.page}
                totalPages={result.totalPages}
                hasNextPage={result.hasNextPage}
                hasPreviousPage={result.hasPreviousPage}
                onPageChange={setPage}
                totalLabel={`${result.total} order${result.total === 1 ? "" : "s"}`}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  );
}

export function CustomersPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const currency = useRestaurantCurrency();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [result, setResult] = useState<Paginated<RestaurantCustomerSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState<string | null>(null);

  // Debounce the search box so every keystroke doesn't fire its own request.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // A new search always restarts at page 1 — staying on, say, page 3 of an old result set would
  // either show a confusing empty page or someone else's page-3 data for the new query.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  useEffect(() => {
    setLoading(true);
    setExpandedCustomerId(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    apiClient
      .request<Paginated<RestaurantCustomerSummary>>(`/restaurants/${restaurantId}/customers?${params}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId, page, debouncedSearch]);

  const customers = result?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Customers</h1>
        <p className="text-sm text-muted">Everyone who has ordered from you, with lifetime order stats.</p>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email..."
        className="max-w-sm rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
      />

      {loading ? (
        <p className="text-muted">Loading customers...</p>
      ) : customers.length === 0 ? (
        <EmptyState
          title={debouncedSearch ? "No matching customers" : "No customers yet"}
          description={
            debouncedSearch
              ? "No customer's name or email matches that search."
              : "Once customers start ordering, they'll show up here."
          }
        />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Orders</th>
                <th className="px-4 py-2.5 font-medium">Total spent</th>
                <th className="px-4 py-2.5 font-medium">Avg order</th>
                <th className="px-4 py-2.5 font-medium">Last order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customers.map((c) => (
                <Fragment key={c.customerId}>
                  <tr
                    onClick={() => setExpandedCustomerId((id) => (id === c.customerId ? null : c.customerId))}
                    aria-expanded={expandedCustomerId === c.customerId}
                    className="cursor-pointer hover:bg-black/[0.02]"
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-foreground underline decoration-dotted">{c.name}</p>
                      <p className="text-xs text-muted">
                        {c.email}
                        {c.phone ? ` · ${c.phone}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-foreground">
                      <Badge tone="neutral">{c.totalOrders}</Badge>
                    </td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{formatCurrency(c.totalSpent, currency)}</td>
                    <td className="px-4 py-2.5 text-muted">{formatCurrency(c.avgOrderValue, currency)}</td>
                    <td className="px-4 py-2.5 text-muted">{new Date(c.lastOrderAt).toLocaleDateString()}</td>
                  </tr>
                  {expandedCustomerId === c.customerId && (
                    <CustomerOrdersRow restaurantId={restaurantId} customerId={c.customerId} />
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hasNextPage={result.hasNextPage}
          hasPreviousPage={result.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${result.total} customer${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
