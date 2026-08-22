import { useEffect, useState } from "react";
import type { DailyAnalyticsPoint, RestaurantAnalytics } from "@restaurant/types";
import { Card, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { useRestaurantCurrency } from "../hooks/useRestaurantCurrency";

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-heading text-2xl font-semibold text-foreground">{value}</span>
    </Card>
  );
}

const RANGE_OPTIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

function TrendChart({ series, metric, currency }: { series: DailyAnalyticsPoint[]; metric: "orders" | "revenue"; currency: string }) {
  const values = series.map((p) => p[metric]);
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const format = (v: number) => (metric === "revenue" ? formatCurrency(v, currency) : String(v));

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        Total: <span className="font-medium text-foreground">{format(total)}</span>
      </p>
      <div className="flex h-32 items-end gap-px" aria-hidden>
        {series.map((point) => (
          <div
            key={point.date}
            title={`${point.date}: ${format(point[metric])}`}
            // Not bg-primary/70: this project's "primary" color is a bare `var(--color-primary)`
            // theme reference (apps/admin/tailwind.config.js), not the `rgb(var(...) / <alpha>)`
            // form Tailwind needs to synthesize opacity modifiers — `bg-primary/70` silently
            // produces no background at all (confirmed: computed background-color is fully
            // transparent). opacity-70 is a standalone utility, unaffected by that gap.
            className="flex-1 rounded-t bg-primary opacity-70 transition-opacity hover:opacity-100"
            style={{ height: `${Math.max(2, (point[metric] / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted">
        <span>{series[0]?.date}</span>
        <span>{series[series.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function AnalyticsPage() {
  const restaurantId = useActiveLocationId();
  const currency = useRestaurantCurrency();
  const [analytics, setAnalytics] = useState<RestaurantAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["days"]>(30);
  const [series, setSeries] = useState<DailyAnalyticsPoint[] | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [metric, setMetric] = useState<"orders" | "revenue">("revenue");

  useEffect(() => {
    apiClient
      .request<{ analytics: RestaurantAnalytics }>(`/restaurants/${restaurantId}/analytics`)
      .then((data) => setAnalytics(data.analytics))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  useEffect(() => {
    setSeriesLoading(true);
    apiClient
      .request<{ series: DailyAnalyticsPoint[] }>(`/restaurants/${restaurantId}/analytics/timeseries?days=${range}`)
      .then((data) => setSeries(data.series))
      .catch((err) => setError((err as Error).message))
      .finally(() => setSeriesLoading(false));
  }, [restaurantId, range]);

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  }

  if (!analytics) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Analytics</h1>
        <p className="text-sm text-muted">
          Revenue reflects orders staff have marked as paid — this platform doesn't process payments directly, so
          unpaid order totals aren't counted.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="Orders today" value={String(analytics.ordersToday)} />
        <MetricCard label="Orders this week" value={String(analytics.ordersThisWeek)} />
        <MetricCard label="Revenue today" value={formatCurrency(analytics.revenueToday, currency)} />
        <MetricCard label="Revenue this week" value={formatCurrency(analytics.revenueThisWeek, currency)} />
        <MetricCard label="Avg order value" value={formatCurrency(analytics.averageOrderValue, currency)} />
        <MetricCard label="Completed this week" value={String(analytics.completedOrdersThisWeek)} />
        <MetricCard label="Cancelled this week" value={String(analytics.cancelledOrdersThisWeek)} />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading font-medium text-foreground">Trend</h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 rounded-pill border border-border p-0.5">
              {(["revenue", "orders"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`rounded-pill px-2.5 py-1 text-xs font-medium capitalize transition-colors duration-fast ${
                    metric === m ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-black/[0.04]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-pill border border-border p-0.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setRange(opt.days)}
                  className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
                    range === opt.days ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-black/[0.04]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {seriesLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : series && series.length > 0 ? (
          <TrendChart series={series} metric={metric} currency={currency} />
        ) : (
          <p className="text-sm text-muted">No order data in this range yet.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-heading font-medium text-foreground">Top-selling items (this week)</h2>
        {analytics.topSellingItems.length === 0 ? (
          <p className="text-sm text-muted">No sales yet this week.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {analytics.topSellingItems.map((item) => (
              <li key={item.menuItemId} className="flex justify-between">
                <span className="text-foreground">{item.name}</span>
                <span className="text-muted">{item.quantitySold} sold</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
