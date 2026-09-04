import { useEffect, useState } from "react";
import type { Order } from "@restaurant/types";
import { Badge, EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency, formatRestaurantTime } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { useRestaurantTimezone } from "../hooks/useRestaurantTimezone";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { IconClock } from "../components/icons";
import { STATUS_LABELS, STATUS_TONE } from "../lib/orderStatusFlow";

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "preparing", "ready", "out_for_delivery"]);

/**
 * Same GET /restaurants/:id/orders + Socket.IO live-refresh OrdersManagementPage.tsx already
 * uses — a read-only operational reference for the register (what's still open, what just
 * finished), not a second order-management surface. Status changes/refunds/etc. stay in
 * Restaurant Admin's Orders page, where the full toolset already exists.
 */
export function PosOrdersPage() {
  const restaurantId = useActiveLocationId();
  const { restaurant } = useRestaurantSettings();
  const timezone = useRestaurantTimezone();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");

  async function reload() {
    const { orders } = await apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/orders`);
    setOrders(orders);
    setError(null);
  }

  useEffect(() => {
    // See RegisterPage.tsx's identical guard.
    if (!restaurantId) return;
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  useRestaurantOrderEvents(() => {
    reload().catch(() => {});
  });

  const currency = restaurant?.settings.currency ?? "USD";
  const visible = filter === "active" ? orders.filter((o) => ACTIVE_STATUSES.has(o.status)) : orders;

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Orders</h1>
        <div className="flex gap-1.5">
          {(["active", "all"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium capitalize transition-colors duration-fast ${
                filter === f ? "bg-primary text-primary-foreground" : "bg-surface text-foreground/70 hover:bg-black/[0.04]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && <EmptyState title="Couldn't load orders" description={error} />}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<IconClock className="h-6 w-6" />} title={filter === "active" ? "No open orders" : "No orders yet"} description="New orders — online, dine-in, or from this register — will show up here." />
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {visible.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {o.orderNumber}
                  {o.channel === "pos" && <span className="text-[11px] font-normal text-muted">· POS</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {o.customerName ?? "—"} ·{" "}
                  {o.orderType === "dine_in" ? `Dine-in · ${o.tableName ?? "Table"}` : o.orderType} · {formatRestaurantTime(o.createdAt, timezone)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-semibold text-foreground">{formatCurrency(o.total, o.currency ?? currency)}</span>
                <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABELS[o.status]}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
