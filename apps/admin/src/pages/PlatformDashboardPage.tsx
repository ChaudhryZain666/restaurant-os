import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PlatformOverview } from "@restaurant/types";
import { Badge, Card, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "danger",
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-heading text-2xl font-semibold text-foreground">{value}</span>
    </Card>
  );
}

/** Real counts only — there's no cross-restaurant analytics service, so this is a control-center
 * summary of what actually exists (restaurants, users, orders, tickets), not a full BI dashboard. */
export function PlatformDashboardPage() {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ overview: PlatformOverview }>("/platform/overview")
      .then((data) => setOverview(data.overview))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !overview) {
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Platform dashboard</h1>
        <p className="text-sm text-muted">Real counts across every restaurant on the platform.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <MetricCard label="Restaurants" value={String(overview.totalRestaurants)} />
        <MetricCard label="Active restaurants" value={String(overview.activeRestaurants)} />
        <MetricCard label="Users" value={String(overview.totalUsers)} />
        <MetricCard label="Orders" value={String(overview.totalOrders)} />
        <MetricCard label="Open tickets" value={String(overview.openSupportTickets)} />
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-heading font-medium text-foreground">Recently added restaurants</h2>
          <Link to="/platform/restaurants" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {overview.recentRestaurants.length === 0 ? (
          <p className="text-sm text-muted">No restaurants yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {overview.recentRestaurants.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-foreground">{r.name}</span>
                <span className="flex items-center gap-3">
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                  <span className="text-muted">{new Date(r.createdAt).toLocaleDateString()}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
