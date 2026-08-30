import { useEffect, useState } from "react";
import type { BusinessAnalyticsOverview, BusinessAnalyticsProducts, BusinessAnalyticsTrends } from "@restaurant/types";
import { Badge, Card, Skeleton } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useBusinessEntitlements } from "../hooks/useBusinessEntitlements";

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-heading text-2xl font-semibold text-foreground">{value}</span>
    </Card>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Phase 23 — business-wide analytics, shown only when a business has more than one location (see
 * Layout.tsx's nav gating) — a single-location owner's one location already IS the business, so
 * the existing per-location AnalyticsPage.tsx is all they ever need.
 *
 * Monetary values are grouped by currency, never summed into one blended total — this platform has
 * no FX-conversion infrastructure, and inventing exchange rates would produce a misleading number.
 * See docs/multi-tenant-storefront-architecture.md's Phase 23 section. A business date range is
 * explicit (not "today"/"this week"): those have no single meaning across locations in different
 * timezones.
 */
export function BusinessAnalyticsPage() {
  const { user } = useAuth();
  const businessId = user!.businessId!;
  const { has, loading: entitlementsLoading } = useBusinessEntitlements(businessId);
  const canView = has("business_analytics");

  const [from, setFrom] = useState(daysAgoIso(6));
  const [to, setTo] = useState(todayIso());
  const [overview, setOverview] = useState<BusinessAnalyticsOverview | null>(null);
  const [trends, setTrends] = useState<BusinessAnalyticsTrends | null>(null);
  const [products, setProducts] = useState<BusinessAnalyticsProducts | null>(null);
  const [trendCurrency, setTrendCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (entitlementsLoading || !canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const qs = `?from=${from}&to=${to}`;
    Promise.all([
      apiClient.request<{ overview: BusinessAnalyticsOverview }>(`/businesses/${businessId}/analytics/overview${qs}`),
      apiClient.request<{ trends: BusinessAnalyticsTrends }>(`/businesses/${businessId}/analytics/trends${qs}`),
      apiClient.request<{ products: BusinessAnalyticsProducts }>(`/businesses/${businessId}/analytics/products${qs}`),
    ])
      .then(([overviewRes, trendsRes, productsRes]) => {
        setOverview(overviewRes.overview);
        setTrends(trendsRes.trends);
        setProducts(productsRes.products);
        setTrendCurrency((current) => current ?? overviewRes.overview.revenueByCurrency[0]?.currency ?? null);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [businessId, from, to, entitlementsLoading, canView]);

  // Phase 39 — a locked/upgrade state, resolved via the same entitlement the server's
  // requireEntitlement("business_analytics") guard checks (businessAnalytics.routes.ts), so this
  // can never disagree with what the API actually allows. The server guard remains authoritative;
  // this only avoids surfacing a raw 403 as the page's content.
  if (!entitlementsLoading && !canView) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Business Analytics</h1>
        </div>
        <Card className="flex flex-col gap-2">
          <Badge tone="warning" className="self-start">
            Upgrade required
          </Badge>
          <p className="text-sm text-foreground">
            Business-wide analytics aren't included on your current plan. Upgrade to Owner — Growth (or an agency
            plan that grants it) to see performance across every location.
          </p>
        </Card>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
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

  if (!overview) return null;

  const multiCurrency = overview.revenueByCurrency.length > 1;
  const trendPoints = trends?.points ?? [];
  const trendValues = trendCurrency
    ? trendPoints.map((p) => p.revenueByCurrency.find((c) => c.currency === trendCurrency)?.amount ?? 0)
    : trendPoints.map((p) => p.orders);
  const trendMax = Math.max(1, ...trendValues);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Business Analytics</h1>
        <p className="text-sm text-muted">
          Across every location. {multiCurrency ? "Locations use different currencies — revenue is shown per currency, never blended into one misleading total." : "Revenue reflects orders staff have marked as paid."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="date" value={to} min={from} max={todayIso()} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <MetricCard label="Total orders" value={String(overview.totalOrders)} />
        {overview.revenueByCurrency.map((c) => (
          <MetricCard key={c.currency} label={`Revenue (${c.currency})`} value={formatCurrency(c.amount, c.currency)} />
        ))}
        {overview.averageOrderValueByCurrency.map((c) => (
          <MetricCard key={c.currency} label={`Avg order value (${c.currency})`} value={formatCurrency(c.amount, c.currency)} />
        ))}
      </div>

      <Card>
        <h2 className="mb-3 font-heading font-medium text-foreground">Location comparison</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="pb-2">Location</th>
                <th className="pb-2">Orders</th>
                <th className="pb-2">Revenue</th>
                <th className="pb-2">Avg order value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {overview.byLocation.map((loc) => (
                <tr key={loc.locationId}>
                  <td className="py-2 text-foreground">{loc.name}</td>
                  <td className="py-2 text-muted">{loc.orders}</td>
                  <td className="py-2 text-muted">{formatCurrency(loc.revenue, loc.currency)}</td>
                  <td className="py-2 text-muted">{formatCurrency(loc.averageOrderValue, loc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading font-medium text-foreground">Trend</h2>
          <div className="flex gap-1 rounded-pill border border-border p-0.5">
            <button
              onClick={() => setTrendCurrency(null)}
              className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
                trendCurrency === null ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-black/[0.04]"
              }`}
            >
              Orders
            </button>
            {overview.revenueByCurrency.map((c) => (
              <button
                key={c.currency}
                onClick={() => setTrendCurrency(c.currency)}
                className={`rounded-pill px-2.5 py-1 text-xs font-medium transition-colors duration-fast ${
                  trendCurrency === c.currency ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-black/[0.04]"
                }`}
              >
                Revenue ({c.currency})
              </button>
            ))}
          </div>
        </div>
        {trendPoints.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex h-32 items-end gap-px" aria-hidden>
              {trendPoints.map((point, i) => (
                <div
                  key={point.date}
                  title={`${point.date}: ${trendValues[i]}`}
                  className="flex-1 rounded-t bg-primary opacity-70 transition-opacity hover:opacity-100"
                  style={{ height: `${Math.max(2, (trendValues[i] / trendMax) * 100)}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted">
              <span>{trendPoints[0]?.date}</span>
              <span>{trendPoints[trendPoints.length - 1]?.date}</span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted">No order data in this range yet.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-heading font-medium text-foreground">Top-selling items (business-wide)</h2>
        {!products || products.items.length === 0 ? (
          <p className="text-sm text-muted">No sales yet in this range.</p>
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {products.items.map((item) => (
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
