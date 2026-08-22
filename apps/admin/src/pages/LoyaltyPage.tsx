import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LoyaltySummary } from "@restaurant/types";
import { Badge, Card, EmptyState, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { IconStar } from "../components/icons";

const TIER_TONE: Record<string, "neutral" | "info" | "warning"> = {
  bronze: "neutral",
  silver: "info",
  gold: "warning",
};

const TIER_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold" };

const ACTIVITY_TONE: Record<string, "success" | "warning" | "neutral"> = {
  earn: "success",
  redeem: "warning",
  adjustment: "neutral",
};

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-heading text-2xl font-semibold text-foreground">{value}</span>
    </Card>
  );
}

/**
 * Loyalty is real and live for customers (1 point per currency unit spent, Bronze/Silver-500/
 * Gold-2000 tiers, redeemable at checkout — see loyalty.service.ts). This page shows the
 * restaurant-wide picture via GET /restaurants/:id/loyalty/summary, a real aggregation over
 * LoyaltyAccount/LoyaltyTransaction — every number here reflects an actual order, never estimated.
 */
export function LoyaltyPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ summary: LoyaltySummary }>(`/restaurants/${restaurantId}/loyalty/summary`)
      .then((data) => setSummary(data.summary))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Loyalty</h1>
        <p className="text-sm text-muted">
          Customers earn 1 point per currency unit spent and can redeem points for a discount at checkout. Tiers:
          Bronze from the start, Silver at 500 points, Gold at 2,000.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : summary ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard label="Loyalty members" value={String(summary.totalMembers)} />
            <MetricCard label="Active members" value={String(summary.activeMembers)} />
            <MetricCard label="Points issued" value={summary.totalPointsIssued.toLocaleString()} />
            <MetricCard label="Points redeemed" value={summary.totalPointsRedeemed.toLocaleString()} />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <h2 className="mb-3 font-heading font-medium text-foreground">Tier distribution</h2>
              <div className="flex flex-col gap-2">
                {(["gold", "silver", "bronze"] as const).map((tier) => {
                  const count = summary.tierDistribution[tier];
                  const max = Math.max(1, summary.totalMembers);
                  return (
                    <div key={tier} className="flex items-center gap-3 text-sm">
                      <span className="w-16 shrink-0">
                        <Badge tone={TIER_TONE[tier]}>{TIER_LABEL[tier]}</Badge>
                      </span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-black/[0.05]">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
                      </div>
                      <span className="w-6 shrink-0 text-right font-medium text-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="lg:col-span-1">
              <h2 className="mb-3 font-heading font-medium text-foreground">Top loyalty customers</h2>
              {summary.topCustomers.length === 0 ? (
                <p className="text-sm text-muted">No loyalty activity yet.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {summary.topCustomers.map((c, i) => (
                    <li key={c.customerId} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-foreground">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        {c.customerName}
                      </span>
                      <span className="flex items-center gap-2">
                        <Badge tone={TIER_TONE[c.tier]}>{TIER_LABEL[c.tier]}</Badge>
                        <span className="font-medium text-foreground">{c.pointsBalance.toLocaleString()} pts</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>

            <Card className="lg:col-span-1">
              <h2 className="mb-3 font-heading font-medium text-foreground">Recent activity</h2>
              {summary.recentActivity.length === 0 ? (
                <p className="text-sm text-muted">No loyalty transactions yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {summary.recentActivity.map((a) => (
                    <li key={a.id} className="flex flex-col gap-0.5 py-2">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-foreground">{a.customerName}</span>
                        <Badge tone={ACTIVITY_TONE[a.type]}>{a.points > 0 ? `+${a.points}` : a.points}</Badge>
                      </span>
                      <span className="text-xs text-muted">
                        {a.reason} · {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {summary.totalMembers === 0 && (
            <EmptyState
              icon={<IconStar className="h-6 w-6" />}
              title="No loyalty activity yet"
              description="Points start accruing automatically the moment a customer places their first order."
            />
          )}
        </>
      ) : null}

      <Card className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconStar className="h-4 w-4" />
        </span>
        <p className="text-sm text-muted">
          Earn/redeem rules (points-per-currency-unit and tier thresholds) aren't configurable per restaurant yet —
          they're a platform-wide default. Per-customer order and spend history is on the{" "}
          <Link to="/customers" className="font-medium text-primary hover:underline">
            Customers page
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
