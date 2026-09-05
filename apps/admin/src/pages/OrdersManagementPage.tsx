import { useEffect, useMemo, useState } from "react";
import type { Order, OrderDeliveryAddress, OrderStatus, OrderType, PaymentStatus } from "@restaurant/types";
import { Badge, Button, Card } from "@restaurant/ui";
import { formatCurrency, formatRestaurantDateTime, formatRestaurantTime } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { OrderLineItems } from "../components/OrderLineItems";
import { OrderPaymentAdmin } from "../components/OrderPaymentAdmin";
import { OrderNotesAndActivity } from "../components/OrderNotesAndActivity";
import { DeliveryStatusPanel } from "../components/DeliveryStatusPanel";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { useRestaurantTimezone } from "../hooks/useRestaurantTimezone";
import {
  ACTIVE_STATUSES as ACTIVE_GROUPS,
  actionLabel,
  isAwaitingOnlinePayment,
  isCancellable,
  nextForwardStatus,
  STATUS_LABELS,
  STATUS_TONE,
} from "../lib/orderStatusFlow";

function formatDeliveryAddress(a: OrderDeliveryAddress): string {
  return [a.line1, a.line2, a.city, a.state, a.postalCode].filter(Boolean).join(", ");
}

function OrderCard({
  order,
  timezone,
  onSetStatus,
  onSetPaymentStatus,
}: {
  order: Order;
  timezone: string | undefined;
  onSetStatus: (order: Order, status: OrderStatus) => void;
  onSetPaymentStatus: (order: Order, paymentStatus: PaymentStatus) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const awaitingOnlinePayment = isAwaitingOnlinePayment(order);
  const next = awaitingOnlinePayment && order.status === "pending" ? null : nextForwardStatus(order);
  const label = actionLabel(order);

  return (
    <Card role="group" aria-label={`Order ${order.orderNumber}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <button onClick={() => setExpanded((v) => !v)} className="font-medium text-foreground underline decoration-dotted">
            {order.orderNumber}
          </button>
          <p className="text-xs text-muted">
            {order.customerName ?? "—"} ·{" "}
            {order.orderType === "dine_in"
              ? `Dine-in · ${order.tableName ?? "Table"}`
              : order.orderType === "delivery"
                ? `Delivery${order.deliveryDistanceKm != null ? ` · ${order.deliveryDistanceKm}km` : ""}`
                : order.orderType}
            {order.channel === "pos" && " · POS"} · {formatRestaurantTime(order.createdAt, timezone)}
          </p>
        </div>
        <Badge tone={order.paymentStatus === "paid" ? "success" : "neutral"}>
          {order.paymentMethod === "online" ? `online · ${order.paymentStatus}` : order.paymentStatus}
        </Badge>
      </div>

      <p className="text-sm text-foreground/80">
        {order.items.length} item{order.items.length === 1 ? "" : "s"} · {formatCurrency(order.total, order.currency)}
      </p>

      {expanded && (
        <div className="flex flex-col gap-2 border-t border-border pt-2 text-xs text-muted">
          <div className="flex flex-wrap gap-4">
            <span>Phone: {order.customerPhone ?? "—"}</span>
            {order.deliveryAddress && <span>Delivery: {formatDeliveryAddress(order.deliveryAddress)}</span>}
            {order.deliveryAddress?.instructions && <span>Instructions: {order.deliveryAddress.instructions}</span>}
            {order.orderType === "dine_in" && order.tableName && <span>Table: {order.tableName}</span>}
          </div>
          <DeliveryStatusPanel order={order} />
          {order.customerNotes && <span>Notes: {order.customerNotes}</span>}
          <OrderLineItems items={order.items} currency={order.currency} />
          <div>
            Subtotal {formatCurrency(order.subtotal, order.currency)} · Tax {formatCurrency(order.taxAmount, order.currency)} ·
            Delivery {formatCurrency(order.deliveryFee, order.currency)}
            {order.discount > 0 && <> · Discount -{formatCurrency(order.discount, order.currency)}</>}
          </div>
          {order.statusHistory.length > 0 && (
            <ul className="flex flex-col gap-0.5">
              {order.statusHistory.map((h, i) => (
                <li key={i}>
                  {STATUS_LABELS[h.status]} — {formatRestaurantDateTime(h.at, timezone)}
                </li>
              ))}
            </ul>
          )}
          {order.paymentMethod === "online" ? (
            <OrderPaymentAdmin order={order} />
          ) : (
            <div>
              {order.paymentStatus === "unpaid" ? (
                <button onClick={() => onSetPaymentStatus(order, "paid")} className="rounded-lg border border-border px-2 py-1 text-foreground/80 transition-colors duration-fast hover:bg-black/[0.03]">
                  Mark as paid
                </button>
              ) : (
                <button onClick={() => onSetPaymentStatus(order, "unpaid")} className="rounded-lg border border-border px-2 py-1 text-foreground/80 transition-colors duration-fast hover:bg-black/[0.03]">
                  Mark as unpaid
                </button>
              )}
            </div>
          )}
          <OrderNotesAndActivity order={order} />
          <div className="flex gap-3 border-t border-border pt-2">
            <button
              onClick={() => window.open(`/print/ticket/${order.id}`, "_blank", "noopener")}
              className="text-xs font-medium text-primary hover:underline"
            >
              Print kitchen ticket
            </button>
            <button
              onClick={() => window.open(`/print/receipt/${order.id}`, "_blank", "noopener")}
              className="text-xs font-medium text-primary hover:underline"
            >
              Print receipt
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {awaitingOnlinePayment && order.status === "pending" && (
          <span className="text-xs text-muted">Waiting for payment</span>
        )}
        {next && label && (
          <Button size="sm" onClick={() => onSetStatus(order, next)}>
            {label}
          </Button>
        )}
        {isCancellable(order.status) && (
          <Button size="sm" variant="ghost" onClick={() => onSetStatus(order, "cancelled")} className="text-danger">
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}

const ORDER_TYPE_OPTIONS: Array<{ value: OrderType | "all"; label: string }> = [
  { value: "all", label: "All types" },
  { value: "pickup", label: "Pickup" },
  { value: "delivery", label: "Delivery" },
  { value: "dine_in", label: "Dine-in" },
];

const PAYMENT_FILTER_OPTIONS: Array<{ value: "all" | PaymentStatus; label: string }> = [
  { value: "all", label: "All payments" },
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
];

export function OrdersManagementPage() {
  const restaurantId = useActiveLocationId();
  const timezone = useRestaurantTimezone();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [orderTypeFilter, setOrderTypeFilter] = useState<OrderType | "all">("all");
  const [paymentFilter, setPaymentFilter] = useState<"all" | PaymentStatus>("all");

  async function reload() {
    const { orders } = await apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/orders`);
    setOrders(orders);
    // A later successful reload always wins over an earlier failed one (e.g. a StrictMode
    // double-mount where one of two concurrent requests transiently failed) — otherwise a
    // stale error banner could sit above data that actually loaded fine.
    setError(null);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // Live updates: any order event for this restaurant triggers a re-fetch of the authoritative
  // list — the socket payload itself is never applied as state (see useRestaurantOrderEvents).
  useRestaurantOrderEvents(() => {
    reload().catch(() => {});
  });

  async function setStatus(order: Order, status: OrderStatus) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setPaymentStatus(order: Order, paymentStatus: PaymentStatus) {
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/payment-status`, {
        method: "PATCH",
        body: { paymentStatus },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const filteredOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (orderTypeFilter !== "all" && o.orderType !== orderTypeFilter) return false;
        if (paymentFilter !== "all" && o.paymentStatus !== paymentFilter) return false;
        if (searchLower) {
          const haystack = `${o.orderNumber} ${o.customerName ?? ""} ${o.tableName ?? ""}`.toLowerCase();
          if (!haystack.includes(searchLower)) return false;
        }
        return true;
      }),
    [orders, orderTypeFilter, paymentFilter, searchLower]
  );

  if (loading) return <p>Loading orders...</p>;

  const byStatus = (status: OrderStatus) => filteredOrders.filter((o) => o.status === status);
  const activeCount = filteredOrders.filter((o) => ACTIVE_GROUPS.includes(o.status)).length;
  const filtersActive = search.trim() !== "" || orderTypeFilter !== "all" || paymentFilter !== "all";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Orders</h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, customer, or table"
            className="w-56 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <select
            value={orderTypeFilter}
            onChange={(e) => setOrderTypeFilter(e.target.value as OrderType | "all")}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
          >
            {ORDER_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as "all" | PaymentStatus)}
            className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
          >
            {PAYMENT_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              onClick={() => {
                setSearch("");
                setOrderTypeFilter("all");
                setPaymentFilter("all");
              }}
              className="text-sm font-medium text-muted hover:text-foreground hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {orders.length === 0 ? (
        <Card className="text-center text-muted">No orders yet.</Card>
      ) : activeCount === 0 ? (
        <Card className="text-center text-muted">
          {filtersActive ? "No active orders match these filters." : "No active orders right now."}
        </Card>
      ) : (
        ACTIVE_GROUPS.map((status) => {
          const group = byStatus(status);
          if (group.length === 0) return null;
          return (
            <section key={status} className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                <span>({group.length})</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((order) => (
                  <OrderCard key={order.id} order={order} timezone={timezone} onSetStatus={setStatus} onSetPaymentStatus={setPaymentStatus} />
                ))}
              </div>
            </section>
          );
        })
      )}

      {(byStatus("completed").length > 0 || byStatus("cancelled").length > 0) && (
        <details className="flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-muted">
            History ({byStatus("completed").length + byStatus("cancelled").length})
          </summary>
          {(["completed", "cancelled"] as const).map((status) => {
            const group = byStatus(status);
            if (group.length === 0) return null;
            return (
              <div key={status} className="mt-2 flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                  <span>({group.length})</span>
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.map((order) => (
                    <OrderCard key={order.id} order={order} timezone={timezone} onSetStatus={setStatus} onSetPaymentStatus={setPaymentStatus} />
                  ))}
                </div>
              </div>
            );
          })}
        </details>
      )}
    </div>
  );
}
