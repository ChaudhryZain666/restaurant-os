import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Order, OrderStatus, Restaurant, RestaurantAnalytics } from "@restaurant/types";
import { roleHasPermission } from "@restaurant/types";
import { Alert, Badge, Card, EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";
import { IconChart, IconClipboard } from "../components/icons";

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "New",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "success",
  out_for_delivery: "success",
  completed: "neutral",
  cancelled: "danger",
};

function MetricCard({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <Card className="flex items-center gap-3">
      {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        <p className="font-heading text-xl font-semibold text-foreground">{value}</p>
      </div>
    </Card>
  );
}

export function DashboardPage() {
  const { user } = useAuth();
  const restaurantId = useActiveLocationId();
  // restaurant_staff/kitchen_staff never hold restaurant.analytics.read — this unconditional
  // fetch used to run for every role, and its failure took the whole page down to an error-only
  // screen on their very first login (Phase 13 audit's P0-5). Fetched once, gates both the
  // analytics/orders requests below and the render branch further down.
  const canViewAnalytics = roleHasPermission(user!.role, "restaurant.analytics.read");
  const canManageSettings = roleHasPermission(user!.role, "restaurant.settings.manage");
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [analytics, setAnalytics] = useState<RestaurantAnalytics | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // LocationContext resolves activeLocationId asynchronously — this can run once with it still
    // unset before the real value lands. Skipping (rather than requesting `/restaurants/undefined`)
    // avoids permanently poisoning `error` with a stale 403/404 that a later, valid run would
    // otherwise never clear (this effect never resets error/loading at the top on its own).
    if (!restaurantId) return;
    setLoading(true);
    setError(null);
    const restaurantReq = apiClient.request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`);
    const analyticsReq = canViewAnalytics
      ? apiClient.request<{ analytics: RestaurantAnalytics }>(`/restaurants/${restaurantId}/analytics`)
      : Promise.resolve(null);
    const ordersReq = canViewAnalytics
      ? apiClient.request<{ orders: Order[] }>(`/restaurants/${restaurantId}/orders`)
      : Promise.resolve(null);

    Promise.all([restaurantReq, analyticsReq, ordersReq])
      .then(([restaurantData, analyticsData, ordersData]) => {
        setRestaurant(restaurantData.restaurant);
        if (analyticsData) setAnalytics(analyticsData.analytics);
        if (ordersData) {
          setOrders([...ordersData.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId, canViewAnalytics]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <p role="alert" className="text-danger">{error}</p>;
  }

  // Owner landing on a restaurant that isn't published yet goes straight to setup — an empty
  // analytics dashboard for a restaurant that can't take orders yet isn't useful to anyone, and
  // this is the one role that can actually act on it (publish requires restaurant.settings.manage).
  if (restaurant && restaurant.status !== "active" && canManageSettings) {
    return <Navigate to="/setup" replace />;
  }

  if (!canViewAnalytics) {
    // Send restaurant_staff/kitchen_staff to the operational page that matches what they can
    // actually do here, instead of the error-only screen this used to be.
    return <Navigate to={user!.role === "kitchen_staff" ? "/kitchen" : "/orders"} replace />;
  }

  if (!analytics) return null;

  const activeOrders = orders.filter((o) => o.status !== "completed" && o.status !== "cancelled").length;
  const recentOrders = orders.slice(0, 6);

  const statusCounts = orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1;
    return acc;
  }, {});
  const distribution = (["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed", "cancelled"] as OrderStatus[])
    .map((status) => ({ status, count: statusCounts[status] ?? 0 }))
    .filter((d) => d.count > 0);
  const maxCount = Math.max(1, ...distribution.map((d) => d.count));

  const currency = restaurant?.settings.currency ?? "USD";
  const revenueWeekShare = analytics.revenueThisWeek > 0 ? (analytics.revenueToday / analytics.revenueThisWeek) * 100 : 0;
  const ordersWeekShare = analytics.ordersThisWeek > 0 ? (analytics.ordersToday / analytics.ordersThisWeek) * 100 : 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted">Here's how the restaurant is doing right now.</p>
      </div>

      {restaurant && restaurant.status === "suspended" && (
        <Alert tone="danger">
          This restaurant has been suspended by the platform and isn't visible to customers. Contact the owner or
          platform support to resolve this.
        </Alert>
      )}
      {restaurant && restaurant.status === "pending" && (
        <Alert tone="warning">
          This restaurant hasn't been published yet — it isn't visible to customers. Ask the owner to finish setup
          and publish it.
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Revenue today" value={formatCurrency(analytics.revenueToday, currency)} icon={<IconChart className="h-5 w-5" />} />
        <MetricCard label="Orders today" value={String(analytics.ordersToday)} icon={<IconClipboard className="h-5 w-5" />} />
        <MetricCard label="Avg. order value" value={formatCurrency(analytics.averageOrderValue, currency)} />
        <MetricCard label="Active orders" value={String(activeOrders)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading font-medium text-foreground">Recent orders</h2>
            <Link to="/orders" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyState icon={<IconClipboard className="h-5 w-5" />} title="No orders yet" description="New orders will show up here as customers check out." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {recentOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{order.orderNumber}</p>
                    <p className="text-xs text-muted">{order.orderType === "delivery" ? "Delivery" : "Pickup"}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-foreground">{formatCurrency(order.total, order.currency)}</span>
                    <Badge tone={STATUS_TONE[order.status]}>{STATUS_LABELS[order.status]}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-heading font-medium text-foreground">Top sellers this week</h2>
          {analytics.topSellingItems.length === 0 ? (
            <p className="text-sm text-muted">No sales yet this week.</p>
          ) : (
            <ol className="flex flex-col gap-2 text-sm">
              {analytics.topSellingItems.slice(0, 6).map((item, i) => (
                <li key={item.menuItemId} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-foreground">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {i + 1}
                    </span>
                    {item.name}
                  </span>
                  <span className="text-muted">{item.quantitySold} sold</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-heading font-medium text-foreground">Order status distribution</h2>
          {distribution.length === 0 ? (
            <p className="text-sm text-muted">No orders yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {distribution.map((d) => (
                <div key={d.status} className="flex items-center gap-3 text-sm">
                  <span className="w-32 shrink-0 text-muted">{STATUS_LABELS[d.status]}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(d.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-6 shrink-0 text-right font-medium text-foreground">{d.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="font-heading font-medium text-foreground">Today vs. this week</h2>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Revenue</span>
              <span>
                {formatCurrency(analytics.revenueToday, currency)} of {formatCurrency(analytics.revenueThisWeek, currency)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-black/[0.05]">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, revenueWeekShare)}%` }} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Orders</span>
              <span>
                {analytics.ordersToday} of {analytics.ordersThisWeek}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-black/[0.05]">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ordersWeekShare)}%` }} />
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
