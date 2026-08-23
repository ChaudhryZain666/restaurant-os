import { useEffect, useState } from "react";
import type { CurrencyAmount, Paginated, SubscriptionStatus } from "@restaurant/types";
import { Badge, Card, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";

interface PlatformSubscriptionRow {
  id: string;
  ownerType: "business" | "agency";
  businessName?: string;
  businessSlug?: string;
  planCode?: string;
  planName?: string;
  status: SubscriptionStatus;
  billingInterval: "monthly" | "yearly";
  currentPeriodEnd: string;
  trialEnd: string | null;
  provider: "mock" | "internal" | "paddle";
  createdAt: string;
}

interface PlatformRevenue {
  mrrByCurrency: CurrencyAmount[];
  liveSubscriptionCount: number;
  trialingCount: number;
}

const STATUS_TONE: Record<SubscriptionStatus, "success" | "neutral" | "warning" | "danger"> = {
  trialing: "warning",
  active: "success",
  past_due: "danger",
  cancelling: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

const PAGE_SIZE = 20;

/**
 * Phase 24 — read-only platform-wide billing overview, replacing the earlier PlaceholderPage stub.
 * Deliberately no admin actions: cancelling/changing a business's plan stays owner-only via
 * billing.manage, which platform_admin never holds (see subscription.controller.ts). This is
 * investigative visibility only, matching how domains/analytics are surfaced read-only elsewhere
 * in the platform admin views.
 */
export function PlatformSubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<PlatformSubscriptionRow> | null>(null);
  const [revenue, setRevenue] = useState<PlatformRevenue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    apiClient
      .request<Paginated<PlatformSubscriptionRow>>(`/platform/subscriptions?page=${page}&limit=${PAGE_SIZE}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    apiClient
      .request<PlatformRevenue>("/platform/revenue")
      .then(setRevenue)
      .catch(() => undefined);
  }, []);

  const rows = result?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Subscriptions</h1>
        <p className="text-sm text-muted">Every business's subscription, across the whole platform. Read-only.</p>
      </div>

      {revenue && (
        <Card className="flex flex-wrap gap-6">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">MRR</p>
            {revenue.mrrByCurrency.length === 0 ? (
              <p className="font-heading text-lg font-medium text-foreground">—</p>
            ) : (
              // Phase 23's "group by currency, never blend" principle — each currency shown as its
              // own figure, never summed into one misleading number.
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
      )}

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {loading ? (
        <p className="text-muted">Loading subscriptions...</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Business</th>
                <th className="py-2 pr-3 font-medium">Plan</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Interval</th>
                <th className="py-2 pr-3 font-medium">Period ends</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((s) => (
                <tr key={s.id}>
                  <td className="py-2.5 pr-3 font-medium text-foreground">{s.businessName ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-muted">{s.planName ?? s.planCode ?? "—"}</td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={STATUS_TONE[s.status]}>{s.status}</Badge>
                  </td>
                  <td className="py-2.5 pr-3 text-muted">{s.billingInterval}</td>
                  <td className="py-2.5 pr-3 text-muted">{new Date(s.currentPeriodEnd).toLocaleDateString()}</td>
                  <td className="py-2.5 pr-3 text-muted">{s.provider}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-center text-sm text-muted">No subscriptions yet.</p>}
        </Card>
      )}
      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hasNextPage={result.hasNextPage}
          hasPreviousPage={result.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${result.total} subscription${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
