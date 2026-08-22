import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Order, Paginated } from "@restaurant/types";
import { Alert, Badge, Card, EmptyState, Pagination, Reveal, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "../lib/orderStatus";
import { useNoIndex } from "../hooks/useNoIndex";

const PAGE_SIZE = 10;

const ORDER_TYPE_LABELS: Record<Order["orderType"], string> = {
  pickup: "Pickup",
  delivery: "Delivery",
  dine_in: "Dine-in",
};

function ReceiptGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}

export function OrdersPage() {
  useNoIndex();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<Order> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  function reload() {
    return apiClient
      .request<Paginated<Order>>(`/orders/mine?page=${page}&limit=${PAGE_SIZE}`)
      .then((data) => setResult(data));
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const orders = result?.items ?? [];

  // Cancelling the last order on a page (or the list shrinking between visits) can leave `page`
  // pointing past the new last page — step back rather than show a confusing "no orders yet"
  // while Previous is still available.
  useEffect(() => {
    if (result && result.items.length === 0 && result.page > 1) {
      setPage(result.page - 1);
    }
  }, [result]);

  async function cancelOrder(orderId: string) {
    setCancellingId(orderId);
    setError(null);
    try {
      await apiClient.request(`/orders/${orderId}/cancel`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-24 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="danger" role="alert" className="mx-auto max-w-2xl">
        {error}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold text-foreground">My orders</h1>
      {orders.length === 0 ? (
        <EmptyState icon={<ReceiptGlyph className="h-6 w-6" />} title="No orders yet" description="Your order history will show up here once you place your first order." />
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((order, i) => (
            <Reveal as="li" index={i} key={order.id}>
              <Card className="flex flex-col gap-2 transition-shadow duration-normal hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <Link to={`/orders/${order.id}`} className="font-medium text-foreground underline decoration-dotted underline-offset-2">
                    {order.orderNumber}
                  </Link>
                  <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
                </div>
                <div className="flex items-center justify-between text-sm text-muted">
                  <span>
                    {new Date(order.createdAt).toLocaleDateString()} · {ORDER_TYPE_LABELS[order.orderType]}
                    {order.tableName ? ` (${order.tableName})` : ""} · {order.items.length} item
                    {order.items.length === 1 ? "" : "s"}
                  </span>
                  <span className="font-medium text-foreground">{formatCurrency(order.total, order.currency)}</span>
                </div>
                <div className="flex gap-4 text-sm">
                  <Link to={`/orders/${order.id}`} className="font-medium text-primary hover:opacity-80">
                    View details
                  </Link>
                  {order.status === "pending" && (
                    <button
                      onClick={() => cancelOrder(order.id)}
                      disabled={cancellingId === order.id}
                      className="font-medium text-danger underline decoration-dotted underline-offset-2 disabled:opacity-50"
                    >
                      {cancellingId === order.id ? "Cancelling..." : "Cancel order"}
                    </button>
                  )}
                </div>
              </Card>
            </Reveal>
          ))}
        </ul>
      )}
      {result && (
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
  );
}
