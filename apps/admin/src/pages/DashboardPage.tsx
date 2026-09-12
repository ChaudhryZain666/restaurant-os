import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import type {
  Order,
  OrderStatus,
  Restaurant,
  RestaurantAnalytics,
  RestaurantAvailability,
  RestaurantReadiness,
  SetupChecklistItem,
} from "@restaurant/types";
import { roleHasPermission } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from "@restaurant/ui";
import { describeAvailability, formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";
import { useActiveBusinessId } from "../context/BusinessContext";
import { useBusinessEntitlements } from "../hooks/useBusinessEntitlements";
import { IconAlertTriangle, IconChart, IconClipboard, IconClock, IconMenuBook, IconSettings, IconStore } from "../components/icons";
import { previewUrl, storefrontUrl } from "../lib/links";
import { READY_CHECK_COPY, EXTENDED_CHECK_COPY } from "../lib/readinessCopy";

/** A plain time-of-day computation (client clock, nothing fetched) — purely a greeting, never used
 *  for anything the restaurant's own timezone-aware availability logic already owns. */
function timeOfDayGreeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

interface AttentionItem {
  tone: "warning" | "success" | "tip";
  text: string;
  to?: string;
  linkLabel?: string;
}

/** Portal UX (Phase 71) — one cohesive "here's what matters right now" list instead of Dashboard's
 *  previous split between a bare metrics grid and a separate "Worth a look" card. Every item comes
 *  from data this page already fetches (readiness/setup-checklist/restaurant.settings) — nothing
 *  invented. `warning` items get the actionable link; `success` are confirmations; `tip` is the
 *  softer, non-blocking suggestion tier (delivery/dine-in/top-seller) the old "Worth a look" card
 *  covered — kept at lower visual weight since those are legitimate permanent choices for many
 *  restaurants (pickup-only is not a problem to "fix"), not omissions. */
function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="flex flex-col gap-1 animate-fade-up">
      <h2 className="mb-1 font-heading text-sm font-semibold text-foreground">Needs your attention</h2>
      <ul className="flex flex-col divide-y divide-border">
        {items.map((item) => (
          <li key={item.text} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
            <span className="flex items-center gap-2">
              {item.tone === "warning" && <IconAlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
              {item.tone === "success" && (
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-success/15 text-[10px] font-bold text-success">
                  ✓
                </span>
              )}
              {item.tone === "tip" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />}
              <span className={item.tone === "success" ? "text-foreground" : "text-foreground/85"}>{item.text}</span>
            </span>
            {item.to && item.linkLabel && (
              <Link to={item.to} className="shrink-0 text-sm font-medium text-primary hover:underline">
                {item.linkLabel} →
              </Link>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

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

/**
 * Phase 64 — the one, clear, primary recovery message this restaurant's owner should see, shown
 * once, at the top of whichever dashboard state they'd otherwise land on (never a full-page
 * takeover — the objective is to preserve the restaurant and guide the owner toward reactivation,
 * not to punish them). `canManage` gates the actionable CTA only — staff/managers still see the
 * informational message, matching BillingPage.tsx's own "only the owner can change/cancel" split.
 */
function LapsedRecoveryBanner({ canManage }: { canManage: boolean }) {
  return (
    <Card className="flex flex-col items-start gap-2 border-amber-200 bg-amber-50">
      <Badge tone="warning">Subscription ended</Badge>
      <p className="font-heading text-lg font-medium text-foreground">Your trial or subscription has ended</p>
      <p className="text-sm text-foreground">
        Your restaurant and all your data are still here — menu, orders, customers, and settings are safe. Choose a
        plan to continue using online ordering and unlock your restaurant's full features.
      </p>
      {canManage ? (
        <div className="mt-1 flex flex-wrap gap-3">
          <Link to="/billing">
            <Button size="sm">Choose a plan</Button>
          </Link>
          <Link to="/support" className="flex items-center text-sm font-medium text-foreground/70 hover:underline">
            Contact support
          </Link>
        </div>
      ) : (
        <p className="text-xs text-muted">Ask the restaurant owner to choose a plan to restore full access.</p>
      )}
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
  // Phase 64 — the one place this Dashboard checks the resolver's own "source" (never re-derives
  // lapsed/never/live itself), so a recovery banner can never show for the wrong reason or disagree
  // with what BillingPage.tsx / the entitlement-gated pages themselves already decide.
  const businessId = useActiveBusinessId();
  const { source: entitlementSource, loading: entitlementSourceLoading } = useBusinessEntitlements(businessId);
  const isLapsed = !entitlementSourceLoading && entitlementSource === "lapsed";
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [availability, setAvailability] = useState<RestaurantAvailability | null>(null);
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
    const restaurantReq = apiClient.request<{ restaurant: Restaurant; availability: RestaurantAvailability }>(
      `/restaurants/${restaurantId}`
    );
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
        setAvailability(restaurantData.availability);
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
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-32 rounded-full" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
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

        {isLapsed && <LapsedRecoveryBanner canManage={canManageSettings} />}

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

  // Portal UX (Phase 71) — one merged attention list, built entirely from data this page already
  // fetches. `warning` tier: real operational gaps with a genuine action (payment/hours, from the
  // same setup-checklist SetupPage.tsx uses — only rendered when that data was actually fetched,
  // i.e. canManageSettings). `success` tier: real confirmations (menu/storefront), so the list still
  // reads as complete/reassuring once nothing needs fixing, not just empty. `tip` tier: the former
  // "Worth a look" recommendations — delivery/dine-in/top-seller — kept at lower visual weight since
  // those are legitimate permanent choices for many restaurants, not omissions to "fix".
  const attentionItems: AttentionItem[] = [];
  if (canManageSettings && checklist.length > 0) {
    const paymentItem = checklist.find((c) => c.key === "payment");
    if (paymentItem && paymentItem.status !== "complete" && paymentItem.status !== "optional") {
      attentionItems.push({
        tone: "warning",
        text: "No payment account connected yet (cash-only works fine without it).",
        to: EXTENDED_CHECK_COPY.payment.to,
        linkLabel: EXTENDED_CHECK_COPY.payment.linkLabel,
      });
    }
    const hoursItem = checklist.find((c) => c.key === "hours");
    if (hoursItem && hoursItem.status !== "complete" && hoursItem.status !== "optional") {
      attentionItems.push({
        tone: "warning",
        text: "Business hours aren't set yet.",
        to: EXTENDED_CHECK_COPY.hours.to,
        linkLabel: EXTENDED_CHECK_COPY.hours.linkLabel,
      });
    }
  }
  const menuCheck = readiness?.checks.find((c) => c.key === "menu");
  if (menuCheck) attentionItems.push({ tone: menuCheck.complete ? "success" : "warning", text: menuCheck.complete ? "Menu is ready" : "Menu isn't ready yet", to: menuCheck.complete ? undefined : READY_CHECK_COPY.menu.to, linkLabel: menuCheck.complete ? undefined : READY_CHECK_COPY.menu.linkLabel });
  if (restaurant) attentionItems.push({ tone: "success", text: "Storefront published" });
  if (restaurant && !restaurant.settings.deliveryEnabled) {
    attentionItems.push({ tone: "tip", text: "Delivery isn't enabled yet.", to: "/delivery", linkLabel: "Turn on delivery" });
  }
  if (restaurant && !restaurant.settings.dineInEnabled) {
    attentionItems.push({ tone: "tip", text: "Dine-in / QR ordering isn't enabled yet.", to: "/tables", linkLabel: "Set up tables" });
  }
  if (analytics.topSellingItems.length > 0) {
    attentionItems.push({
      tone: "tip",
      text: `Your top seller this week is ${analytics.topSellingItems[0].name}.`,
      to: "/analytics",
      linkLabel: "See more trends",
    });
  }
  // Warnings first, then confirmations, then soft tips — so the one thing worth acting on is never
  // buried below reassurance text.
  const toneOrder: Record<AttentionItem["tone"], number> = { warning: 0, success: 1, tip: 2 };
  attentionItems.sort((a, b) => toneOrder[a.tone] - toneOrder[b.tone]);

  const quickActions = [
    { label: "Add menu item", to: "/menu", icon: IconMenuBook },
    { label: "View orders", to: "/orders", icon: IconClipboard },
    { label: "Manage hours", to: "/settings?tab=hours", icon: IconClock },
    { label: "Edit restaurant", to: "/settings", icon: IconSettings },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
      <div className="animate-fade-up">
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          {timeOfDayGreeting()}
          {restaurant ? `, ${restaurant.name}` : ""}.
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">Here's what's happening with your restaurant today.</p>
          {availability && restaurant && (
            <Badge tone={availability.status === "open" ? "success" : availability.status === "paused" ? "warning" : "neutral"}>
              {describeAvailability(availability, restaurant.settings.timezone)}
            </Badge>
          )}
        </div>
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
      {isLapsed && <LapsedRecoveryBanner canManage={canManageSettings} />}

      {/* Portal UX (Phase 71) — a compact shortcut row, not a grid of buttons. Every target is an
          existing route; "Open storefront" only appears once we actually know the real URL. */}
      <div className="flex flex-wrap items-center gap-2">
        {quickActions.map((action) => (
          <Link
            key={action.to}
            to={action.to}
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-black/[0.03]"
          >
            <action.icon className="h-4 w-4 text-muted" />
            {action.label}
          </Link>
        ))}
        {restaurant && (
          <a
            href={storefrontUrl(restaurant.slug)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-medium text-foreground transition-colors duration-fast hover:bg-black/[0.03]"
          >
            <IconStore className="h-4 w-4 text-muted" />
            Open storefront ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Revenue today" value={formatCurrency(analytics.revenueToday, currency)} icon={<IconChart className="h-5 w-5" />} />
        <MetricCard label="Orders today" value={String(analytics.ordersToday)} icon={<IconClipboard className="h-5 w-5" />} />
        <MetricCard label="Avg. order value" value={formatCurrency(analytics.averageOrderValue, currency)} />
        <MetricCard label="Active orders" value={String(activeOrders)} />
      </div>

      <AttentionList items={attentionItems} />

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
