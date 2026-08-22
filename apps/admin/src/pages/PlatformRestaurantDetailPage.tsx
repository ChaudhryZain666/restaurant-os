import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { PlatformRestaurantDetail } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "danger",
};

/**
 * Phase 16 — the single-restaurant counterpart to PlatformRestaurantsPage's list, so a platform
 * admin investigating one tenant (a support request, an onboarding stall, a suspension decision)
 * doesn't have to reconstruct its state by eye from a list row. Every number here comes from
 * GET /platform/restaurants/:id, which platform.controller.ts assembles read-only without granting
 * platform_admin any owner-level restaurant permission — see that endpoint's doc comment.
 */
export function PlatformRestaurantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<PlatformRestaurantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function reload() {
    return apiClient.request<PlatformRestaurantDetail>(`/platform/restaurants/${id}`).then(setDetail);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function setStatus(nextStatus: "active" | "suspended") {
    if (
      nextStatus === "suspended" &&
      !window.confirm(`Suspend "${detail?.restaurant.name}"? Its storefront and ordering will stop working immediately.`)
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/platform/restaurants/${id}/status`, { method: "PATCH", body: { status: nextStatus } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const data = await apiClient.request<{ message: string }>(`/platform/restaurants/${id}/resend-owner-invite`, {
        method: "POST",
      });
      setNotice(data.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading restaurant...</p>;
  if (error && !detail)
    return (
      <Alert tone="danger" role="alert">
        {error}
      </Alert>
    );
  if (!detail) return null;

  const { restaurant, owner, readiness, analytics, orderCountLifetime, recentAuditLog, businessLocationCount } = detail;

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={() => navigate("/platform/restaurants")} className="mb-1 text-xs font-medium text-primary hover:underline">
            ← All restaurants
          </button>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold text-foreground">
            {restaurant.name}
            <Badge tone={STATUS_TONE[restaurant.status] ?? "neutral"}>{restaurant.status}</Badge>
          </h1>
          <p className="text-sm text-muted">/{restaurant.slug}</p>
        </div>
        <div className="flex gap-2">
          {owner?.invitePending && (
            <Button size="sm" variant="ghost" onClick={resendInvite} disabled={busy}>
              Resend owner invite
            </Button>
          )}
          <Button
            size="sm"
            variant={restaurant.status === "suspended" ? "primary" : "destructive"}
            onClick={() => setStatus(restaurant.status === "suspended" ? "active" : "suspended")}
            disabled={busy}
          >
            {restaurant.status === "suspended" ? "Reactivate" : "Suspend"}
          </Button>
        </div>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Profile</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Location</dt>
              <dd className="text-right text-foreground">{[restaurant.city, restaurant.state, restaurant.country].filter(Boolean).join(", ") || "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Currency</dt>
              <dd className="text-foreground">{restaurant.settings.currency}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Timezone</dt>
              <dd className="text-foreground">{restaurant.settings.timezone}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Cash / Online payment</dt>
              <dd className="text-foreground">
                {restaurant.settings.cashEnabled ? "Cash" : null}
                {restaurant.settings.cashEnabled && restaurant.settings.onlinePaymentEnabled ? " · " : null}
                {restaurant.settings.onlinePaymentEnabled ? "Online" : null}
                {!restaurant.settings.cashEnabled && !restaurant.settings.onlinePaymentEnabled ? "—" : null}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Created</dt>
              <dd className="text-foreground">{new Date(restaurant.createdAt).toLocaleDateString()}</dd>
            </div>
            {businessLocationCount > 1 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Business</dt>
                <dd className="text-foreground">{businessLocationCount} locations</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Owner</h2>
          {owner ? (
            <dl className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Name</dt>
                <dd className="text-foreground">{owner.name}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Email</dt>
                <dd className="text-right text-foreground">{owner.email}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted">Status</dt>
                <dd>
                  {owner.invitePending ? (
                    <Badge tone="warning">Invite pending</Badge>
                  ) : owner.isActive ? (
                    <Badge tone="success">Active</Badge>
                  ) : (
                    <Badge tone="neutral">Deactivated</Badge>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">This restaurant's owner account no longer exists.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Setup readiness</h2>
          <p className="mb-2 text-sm text-foreground">
            {readiness.ready ? <Badge tone="success">Ready to publish</Badge> : <Badge tone="neutral">Not ready yet</Badge>}
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {readiness.checks.map((check) => (
              <li key={check.key} className="flex items-center gap-2">
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    check.complete ? "bg-success/15 text-success" : "border border-border text-muted"
                  }`}
                  aria-hidden
                >
                  {check.complete ? "✓" : ""}
                </span>
                <span className="text-foreground">{check.label}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Activity</h2>
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Orders (lifetime)</dt>
              <dd className="text-foreground">{orderCountLifetime}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Orders today</dt>
              <dd className="text-foreground">{analytics.ordersToday}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Revenue today</dt>
              <dd className="text-foreground">{formatCurrency(analytics.revenueToday, restaurant.settings.currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Revenue this week</dt>
              <dd className="text-foreground">{formatCurrency(analytics.revenueThisWeek, restaurant.settings.currency)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Recent activity</h2>
        {recentAuditLog.length === 0 ? (
          <p className="text-sm text-muted">No recorded activity yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {recentAuditLog.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2">
                <span className="text-foreground">{entry.action}</span>
                <span className="text-xs text-muted">{new Date(entry.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
