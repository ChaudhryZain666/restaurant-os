import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import type { Order, OrderStatus, Restaurant, RestaurantAnalytics, RestaurantReadiness, SetupChecklistItem } from "@restaurant/types";
import { roleHasPermission } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";
import { IconChart, IconClipboard } from "../components/icons";
import { previewUrl } from "../lib/links";
import { READY_CHECK_COPY } from "../lib/readinessCopy";

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
  const [readiness, setReadiness] = useState<RestaurantReadiness | null>(null);
  const [checklist, setChecklist] = useState<SetupChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  function load() {
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
    // Portal UX phase — the same readiness/setup-checklist endpoints SetupPage.tsx already calls
    // (restaurantReadiness.service.ts), fetched here too so a not-yet-published restaurant's
    // Dashboard can render its own "get ready" state in place instead of redirecting away from it.
    // Only fetched for the role that can actually act on Setup — a manager/staff account without
    // restaurant.settings.manage has nothing to do with this data.
    const readinessReq = canManageSettings
      ? apiClient.request<RestaurantReadiness>(`/restaurants/${restaurantId}/readiness`)
      : Promise.resolve(null);
    const checklistReq = canManageSettings
      ? apiClient.request<{ items: SetupChecklistItem[] }>(`/restaurants/${restaurantId}/setup-checklist`)
      : Promise.resolve(null);

    return Promise.all([restaurantReq, analyticsReq, ordersReq, readinessReq, checklistReq])
      .then(([restaurantData, analyticsData, ordersData, readinessData, checklistData]) => {
        setRestaurant(restaurantData.restaurant);
        if (analyticsData) setAnalytics(analyticsData.analytics);
        if (ordersData) {
          setOrders([...ordersData.orders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
        }
        if (readinessData) setReadiness(readinessData);
        if (checklistData) setChecklist(checklistData.items);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, canViewAnalytics, canManageSettings]);

  async function handlePublish() {
    setPublishing(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/publish`, { method: "PATCH" });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

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

  // Portal UX phase — a restaurant that can't take orders yet used to just redirect straight to
  // Setup; an empty analytics dashboard genuinely isn't useful before that, but bouncing away
  // wasted the one chance to explain anything in context. This renders the same readiness data
  // in place instead — Setup (linked below) still exists for the full checklist, this is just the
  // first thing an owner sees. Only the role that can actually act on it (publish requires
  // restaurant.settings.manage) sees this branch at all; others fall through to the analytics
  // redirect below, same as before.
  if (restaurant && restaurant.status !== "active" && canManageSettings) {
    if (restaurant.status === "suspended") {
      return (
        <div className="flex max-w-2xl flex-col gap-4">
          <h1 className="font-heading text-2xl font-semibold text-foreground">Dashboard</h1>
          <Alert tone="danger">
            This restaurant has been suspended by the platform and isn't visible to customers. Contact platform
            support to resolve this.
          </Alert>
          <Link to="/support" className="text-sm font-medium text-primary hover:underline">
            Contact support →
          </Link>
        </div>
      );
    }

    const requiredChecks = readiness?.checks ?? [];
    const doneCount = requiredChecks.filter((c) => c.complete).length;

    return (
      <div className="flex max-w-2xl flex-col gap-5">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Welcome to your restaurant</h1>
          <p className="text-sm text-muted">
            Your restaurant isn't ready to take its first online order yet — here's what's left.
          </p>
        </div>

        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}

        <Card className="flex flex-col gap-1">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Get your restaurant ready</p>
            <span className="text-xs font-medium text-muted">
              {doneCount} of {requiredChecks.length} ready
            </span>
          </div>
          <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${requiredChecks.length ? (doneCount / requiredChecks.length) * 100 : 0}%` }}
            />
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {requiredChecks.map((check) => {
              const copy = READY_CHECK_COPY[check.key];
              return (
                <li key={check.key} className="flex items-start justify-between gap-3 py-3">
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                        check.complete ? "bg-success/15 text-success" : "border border-border text-muted"
                      }`}
                      aria-hidden
                    >
                      {check.complete ? "✓" : ""}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-foreground">{copy?.title ?? check.label}</p>
                      {copy && <p className="text-xs text-muted">{copy.why}</p>}
                    </div>
                  </div>
                  {!check.complete && copy && (
                    <Link to={copy.to} className="shrink-0 text-sm font-medium text-primary hover:underline">
                      {copy.linkLabel} →
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          {restaurant && (
            <a
              href={previewUrl(restaurant.slug)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-primary hover:underline"
            >
              Preview storefront ↗
            </a>
          )}
          <Button onClick={handlePublish} disabled={!readiness?.ready || publishing}>
            {publishing ? "Publishing..." : "Publish restaurant"}
          </Button>
          <Link to="/setup" className="text-sm font-medium text-foreground/70 hover:underline">
            See full setup checklist →
          </Link>
        </div>
        {!readiness?.ready && <p className="text-xs text-muted">Finish the items above to enable publishing.</p>}
        {checklist.length > 0 && (
          <p className="text-xs text-muted">
            Once you're live, {checklist.length} more optional setup items (branding, hours, staff, and more) will
            still be here — none of them block publishing.
          </p>
        )}
      </div>
    );
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

  // Portal UX phase — "Worth a look": 2-3 real, cheaply-available recommendations, not a fake
  // intelligence engine. Every one is derived directly from data already on this page (restaurant
  // settings already fetched above, analytics already fetched above) — nothing invented, nothing
  // requiring a new endpoint.
  const recommendations: { text: string; to: string; linkLabel: string }[] = [];
  if (restaurant && !restaurant.settings.deliveryEnabled) {
    recommendations.push({ text: "Delivery isn't enabled yet.", to: "/delivery", linkLabel: "Turn on delivery" });
  }
  if (restaurant && !restaurant.settings.dineInEnabled) {
    recommendations.push({ text: "Dine-in / QR ordering isn't enabled yet.", to: "/tables", linkLabel: "Set up tables" });
  }
  if (analytics.topSellingItems.length > 0) {
    recommendations.push({
      text: `Your top seller this week is ${analytics.topSellingItems[0].name}.`,
      to: "/analytics",
      linkLabel: "See more trends",
    });
  }

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

      {recommendations.length > 0 && (
        <Card className="flex flex-col gap-2">
          <h2 className="font-heading text-sm font-medium text-foreground">Worth a look</h2>
          <ul className="flex flex-col divide-y divide-border">
            {recommendations.map((r) => (
              <li key={r.text} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-foreground/80">{r.text}</span>
                <Link to={r.to} className="shrink-0 font-medium text-primary hover:underline">
                  {r.linkLabel} →
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-heading font-medium text-foreground">Recent orders</h2>
            <Link to="/orders" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <EmptyState
              icon={<IconClipboard className="h-5 w-5" />}
              title="Your first order is waiting to happen"
              description="Once a customer checks out, their order shows up here."
              action={
                restaurant ? (
                  <a href={previewUrl(restaurant.slug)} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">
                    Preview your online restaurant ↗
                  </a>
                ) : undefined
              }
            />
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
