import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Order } from "@restaurant/types";
import { Badge, Button, EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency, formatElapsed } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { useRestaurantOrderEvents } from "../hooks/useRestaurantOrderEvents";
import { IconClock, IconRegister } from "../components/icons";

/**
 * Phase 75 — the dedicated recovery surface for an interrupted/abandoned POS sale (browser closed
 * mid-sale, a declined card payment never retried, a deliberately tabbed dine-in order). Every
 * order here is real and already exists — nothing is created here; this is purely a filtered,
 * actionable view over the same Order documents PosOrdersPage.tsx already lists, scoped server-side
 * to this location's still-unpaid, non-cancelled POS sales (GET .../pos/pending-sales, gated by the
 * exact same requireTenantMatch()+restaurant.pos.operate every other POS route uses).
 *
 * "Resume" hands the order to RegisterPage.tsx via router state (the same handoff pattern already
 * used for CustomerPicker's "start a new sale for this customer" flow) — it does NOT create a new
 * payment attempt itself; RegisterPage renders straight into PaymentConfirmation/TerminalCardPayment
 * for the existing order, which already safely reuses any in-flight terminal payment rather than
 * starting a second one (see posTerminalPayment.service.ts's createPosTerminalPayment). Any staff
 * member with restaurant.pos.operate at this location can resume ANY pending sale here — the same
 * breadth restaurant.orders.manage already grants over every other order in this codebase, not a
 * new, narrower rule invented just for this page (see docs/pos-architecture.md's Phase 75 section
 * for the full reasoning). The UI still always names the original creator, so "whose sale is this"
 * is never ambiguous even though anyone authorized can act on it.
 */
export function PendingSalesPage() {
  const restaurantId = useActiveLocationId();
  const { restaurant } = useRestaurantSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(new Date());
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function reload() {
    const { orders } = await apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/pos/pending-sales`);
    setOrders(orders);
    setError(null);
  }

  useEffect(() => {
    if (!restaurantId) return;
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  useRestaurantOrderEvents(() => {
    reload().catch(() => {});
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (restaurant?.settings.posEnabled === false) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<IconRegister className="h-6 w-6" />}
          title="POS is not enabled for this location"
          description="Turn on the POS terminal under Settings → Ordering in Restaurant Admin to start ringing up in-person sales."
        />
      </div>
    );
  }

  const currency = restaurant?.settings.currency ?? "USD";

  function resume(order: Order) {
    navigate("/pos", { state: { resumeOrder: order } });
  }

  async function cancelSale(order: Order) {
    if (!window.confirm(`Cancel ${order.orderNumber}? This cannot be undone.`)) return;
    setCancellingId(order.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status: "cancelled" },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex h-full flex-col p-6">
      <div className="mb-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">Pending sales</h1>
        <p className="text-sm text-muted">Orders rung up here that haven't been paid yet.</p>
      </div>

      {error && (
        <EmptyState
          title="Couldn't load pending sales"
          description={error}
          action={
            <Button size="sm" onClick={() => reload().catch((err) => setError((err as Error).message))}>
              Retry
            </Button>
          }
        />
      )}

      {!error && loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : !error && orders.length === 0 ? (
        <EmptyState
          icon={<IconClock className="h-6 w-6" />}
          title="No pending sales"
          description="Completed and cancelled sales aren't shown here — this is only for orders still waiting on payment."
        />
      ) : !error ? (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {orders.map((order) => {
            const since = new Date(order.createdAt);
            const isOwnSale = order.createdByUserId === user?.id;
            return (
              <li key={order.id} className="flex flex-col gap-2.5 rounded-xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-heading text-base font-semibold text-foreground">{order.orderNumber}</span>
                    <Badge tone="warning">Unpaid</Badge>
                    <span className="rounded-pill bg-black/[0.04] px-2 py-0.5 text-xs font-medium text-foreground/70">
                      {formatElapsed(since, now)}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm text-muted">
                    {order.customerName ?? "Walk-in"} ·{" "}
                    {order.orderType === "dine_in" ? `Dine-in · ${order.tableName ?? "Table"}` : order.orderType} ·{" "}
                    {formatCurrency(order.total, order.currency ?? currency)}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {isOwnSale ? "Started by you" : `Started by ${order.createdByName ?? "another staff member"}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                  <Button variant="outline" size="sm" disabled={cancellingId === order.id} onClick={() => cancelSale(order)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => resume(order)}>
                    Resume
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
