import { useEffect, useState } from "react";
import type { CurrencyAmount, SubscriptionStatus } from "@restaurant/types";
import { Badge, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

interface PlatformOverview {
  totalRestaurants: number;
  activeRestaurants: number;
  totalUsers: number;
  totalOrders: number;
  openSupportTickets: number;
}

interface PlatformRevenue {
  mrrByCurrency: CurrencyAmount[];
  liveSubscriptionCount: number;
  trialingCount: number;
}

interface PlatformAnalytics {
  subscriptionsByStatus: Array<{ status: SubscriptionStatus; count: number }>;
  totalLocations: number;
  businessesByOwnership: { agencyManaged: number; direct: number };
  newRestaurantsLast30Days: number;
  newAgenciesLast30Days: number;
  signupsByDate: Array<{ date: string; restaurants: number; agencies: number }>;
}

const STATUS_TONE: Record<SubscriptionStatus, "success" | "neutral" | "warning" | "danger"> = {
  trialing: "warning",
  active: "success",
  past_due: "danger",
  cancelling: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

/**
 * Phase 28 — replaces the earlier PlaceholderPage stub. Composes three sources, all read-only: the
 * existing /platform/overview and /platform/revenue endpoints (unchanged, already real), plus a new
 * /platform/analytics endpoint for the handful of genuinely new aggregations (subscription-status
 * breakdown, total locations, agency-vs-direct business split, signups trend). MRR stays
 * currency-grouped — the same "never blend currencies" principle Phase 23/27 established, never a
 * single misleading total.
 */
export function PlatformAnalyticsPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [revenue, setRevenue] = useState<PlatformRevenue | null>(null);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiClient.request<{ overview: PlatformOverview }>("/platform/overview"),
      apiClient.request<PlatformRevenue>("/platform/revenue"),
      apiClient.request<PlatformAnalytics>("/platform/analytics"),
    ])
      .then(([overviewRes, revenueRes, analyticsRes]) => {
        setOverview(overviewRes.overview);
        setRevenue(revenueRes);
        setAnalytics(analyticsRes);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const maxDailySignups = analytics ? Math.max(1, ...analytics.signupsByDate.map((d) => d.restaurants + d.agencies)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Platform analytics</h1>
        <p className="text-sm text-muted">Cross-tenant totals and trends. Read-only.</p>
      </div>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading analytics...</p>
      ) : (
        overview &&
        revenue &&
        analytics && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <p className="text-xs uppercase tracking-wide text-muted">Restaurants</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{overview.totalRestaurants}</p>
                <p className="text-xs text-muted">{overview.activeRestaurants} active</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wide text-muted">Locations</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{analytics.totalLocations}</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wide text-muted">Users</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{overview.totalUsers}</p>
              </Card>
              <Card>
                <p className="text-xs uppercase tracking-wide text-muted">Orders (lifetime)</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{overview.totalOrders}</p>
              </Card>
            </div>

            <Card className="flex flex-wrap gap-6">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">MRR</p>
                {revenue.mrrByCurrency.length === 0 ? (
                  <p className="font-heading text-lg font-medium text-foreground">—</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {revenue.mrrByCurrency.map((c) => (
                      <p key={c.currency} className="font-heading text-lg font-medium text-foreground">
                        {c.amount.toLocaleString(undefined, { style: "currency", currency: c.currency })}
                        <span className="ml-1 text-xs font-normal text-muted">{c.currency}/mo</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Live subscriptions</p>
                <p className="font-heading text-lg font-medium text-foreground">{revenue.liveSubscriptionCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Trialing</p>
                <p className="font-heading text-lg font-medium text-foreground">{revenue.trialingCount}</p>
              </div>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <p className="mb-2 font-heading text-sm font-medium text-foreground">Subscriptions by status</p>
                <ul className="flex flex-col gap-1.5">
                  {analytics.subscriptionsByStatus.map((s) => (
                    <li key={s.status} className="flex items-center justify-between text-sm">
                      <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                      <span className="text-foreground">{s.count}</span>
                    </li>
                  ))}
                  {analytics.subscriptionsByStatus.length === 0 && <p className="text-sm text-muted">No subscriptions yet.</p>}
                </ul>
              </Card>
              <Card>
                <p className="mb-2 font-heading text-sm font-medium text-foreground">Businesses by ownership</p>
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Agency-managed</span>
                    <span className="text-foreground">{analytics.businessesByOwnership.agencyManaged}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Independently owned</span>
                    <span className="text-foreground">{analytics.businessesByOwnership.direct}</span>
                  </div>
                </div>
              </Card>
            </div>

            <Card>
              <div className="mb-3 flex items-center justify-between">
                <p className="font-heading text-sm font-medium text-foreground">New signups — last 30 days</p>
                <p className="text-xs text-muted">
                  {analytics.newRestaurantsLast30Days} restaurants · {analytics.newAgenciesLast30Days} agencies
                </p>
              </div>
              {analytics.signupsByDate.length === 0 ? (
                <p className="text-sm text-muted">No signups in the last 30 days.</p>
              ) : (
                <div className="flex h-24 items-end gap-1 overflow-x-auto">
                  {analytics.signupsByDate.map((d) => {
                    const total = d.restaurants + d.agencies;
                    return (
                      <div
                        key={d.date}
                        title={`${d.date}: ${d.restaurants} restaurants, ${d.agencies} agencies`}
                        className="flex w-3 shrink-0 flex-col justify-end"
                      >
                        <div
                          className="w-full rounded-t bg-primary/70"
                          style={{ height: `${Math.max(2, (total / maxDailySignups) * 100)}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </>
        )
      )}
    </div>
  );
}
