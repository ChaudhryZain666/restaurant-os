import { useEffect, useState } from "react";
import type { Order, OrderStatus } from "@restaurant/types";
import { Badge, Button, Card } from "@restaurant/ui";
import { getStatusTimestamp, formatElapsed } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { useSocketStatus } from "../hooks/useSocketStatus";
import { ScopeBadge } from "../components/ScopeBadge";
import {
  actionLabel,
  isAwaitingOnlinePayment,
  nextForwardStatus,
  STATUS_LABELS,
  STATUS_TONE,
} from "../lib/orderStatusFlow";

const KDS_COLUMNS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"];

/** Portal UX safety phase — one line per column explaining what an empty column actually means,
 *  instead of five identical "Nothing here." repeats on a brand-new restaurant's first look. */
const EMPTY_COLUMN_COPY: Record<OrderStatus, string> = {
  pending: "New orders will appear here as customers place them.",
  confirmed: "Accepted orders waiting to start cooking will appear here.",
  preparing: "Orders being cooked right now will appear here.",
  ready: "Orders ready for pickup or dispatch will appear here.",
  out_for_delivery: "Orders currently out for delivery will appear here.",
  completed: "",
  cancelled: "",
};

function KitchenOrderCard({ order, now, onSetStatus }: { order: Order; now: Date; onSetStatus: (order: Order, status: OrderStatus) => void }) {
  const awaitingPayment = isAwaitingOnlinePayment(order);
  const next = awaitingPayment && order.status === "pending" ? null : nextForwardStatus(order);
  const label = actionLabel(order);
  const since = getStatusTimestamp(order.statusHistory, order.status) ?? new Date(order.createdAt);

  return (
    <Card role="group" aria-label={`Order ${order.orderNumber}`} className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-heading text-lg font-semibold text-foreground">{order.orderNumber}</span>
        <span className="rounded-pill bg-black/[0.04] px-2 py-0.5 text-xs font-medium text-foreground/70">
          {formatElapsed(since, now)}
        </span>
      </div>
      <p className="text-xs uppercase tracking-wide text-muted">
        {order.orderType === "dine_in" ? (
          <span className="font-semibold text-primary">Dine-in · {order.tableName ?? "Table"}</span>
        ) : order.orderType === "delivery" ? (
          <span className="font-semibold text-primary">Delivery{order.deliveryAddress ? ` · ${order.deliveryAddress.city}` : ""}</span>
        ) : (
          order.orderType
        )}
        {order.customerName ? ` · ${order.customerName}` : ""}
      </p>

      {awaitingPayment && (
        <Badge tone="warning" className="self-start">
          Waiting for payment
        </Badge>
      )}

      <ul className="flex flex-col gap-1.5 border-t border-border pt-2 text-sm">
        {order.items.map((item, i) => (
          <li key={i}>
            <span className="font-semibold text-foreground">{item.quantity}×</span> {item.name}
            {item.selectedModifiers.length > 0 && (
              <span className="block pl-4 text-xs text-muted">
                {item.selectedModifiers.map((m) => m.optionName).join(", ")}
              </span>
            )}
            {item.specialInstructions && (
              <span className="block pl-4 text-xs font-medium text-danger">"{item.specialInstructions}"</span>
            )}
          </li>
        ))}
      </ul>

      {order.customerNotes && (
        <p className="rounded-lg bg-black/[0.03] px-2 py-1.5 text-xs text-foreground/80">Note: {order.customerNotes}</p>
      )}

      <div className="mt-1 flex items-center gap-2">
        {next && label && (
          <Button size="sm" onClick={() => onSetStatus(order, next)}>
            {label}
          </Button>
        )}
        <button
          onClick={() => window.open(`/print/ticket/${order.id}`, "_blank", "noopener")}
          className="text-xs font-medium text-primary hover:underline"
        >
          Print ticket
        </button>
      </div>
    </Card>
  );
}

/**
 * Kitchen-focused screen: active orders only (see order.controller.ts's ?active=true), grouped
 * into workflow columns, no search/refund/customer-contact clutter — that's what
 * OrdersManagementPage is for. Deliberately no animation on card entry/reorder: a KDS screen
 * needs to be scanned fast, not admired.
 */
export function KitchenPage() {
  const restaurantId = useActiveLocationId();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const socketStatus = useSocketStatus();
  const { restaurant: restaurantSettings, loading: settingsLoading } = useRestaurantSettings();

  async function reload() {
    const { orders } = await apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/orders?active=true`);
    setOrders(orders);
    setError(null);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useRestaurantOrderEvents(() => {
    reload().catch(() => {});
  });

  // Elapsed-time ticks locally every 30s — the anchor timestamp itself always comes from
  // statusHistory (server truth), this only re-renders the "Xm ago" text.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

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

  if (loading || settingsLoading) return <p>Loading kitchen orders...</p>;

  if (restaurantSettings?.settings.kitchenEnabled === false) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Kitchen</h1>
        <p className="text-sm text-muted">
          Kitchen operations are turned off for this restaurant. Orders continue to work normally — this screen is
          just hidden. Re-enable it from{" "}
          <a href="/settings" className="font-medium text-primary hover:underline">
            Settings → Ordering
          </a>
          .
        </p>
      </div>
    );
  }

  const byStatus = (status: OrderStatus) =>
    orders.filter((o) => o.status === status).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold text-foreground">Kitchen</h1>
            <ScopeBadge scope="location" />
          </div>
          <p className="text-sm text-muted">Keep every order moving from new to ready.</p>
        </div>
        {socketStatus !== "connected" && <span className="text-xs text-muted">Reconnecting live updates…</span>}
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {/* A Kanban board's columns naturally scroll horizontally rather than reflow into fewer,
          taller columns — a plain flex row (not a responsive grid-cols count) keeps every column
          exactly as wide as it needs to be regardless of viewport, avoiding the column-count
          breakpoint math fighting with each column's own min-width. */}
      <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
        {KDS_COLUMNS.map((status) => {
          const group = byStatus(status);
          return (
            <div key={status} className="flex w-[280px] shrink-0 flex-col gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
                <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                <span>({group.length})</span>
              </h2>
              <div className="flex flex-col gap-3">
                {group.length === 0 && <p className="text-xs text-muted">{EMPTY_COLUMN_COPY[status]}</p>}
                {group.map((order) => (
                  <KitchenOrderCard key={order.id} order={order} now={now} onSetStatus={setStatus} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
