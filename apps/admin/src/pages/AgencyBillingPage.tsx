import { useEffect, useState } from "react";
import type { BillingHistoryEvent, Paginated, Plan, Subscription } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";

const STATUS_TONE: Record<Subscription["status"], "success" | "neutral" | "warning" | "danger"> = {
  trialing: "warning",
  active: "success",
  past_due: "danger",
  cancelling: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

const STATUS_LABEL: Record<Subscription["status"], string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Payment failed",
  cancelling: "Cancelling",
  cancelled: "Cancelled",
  expired: "Trial expired",
};

const HISTORY_LABEL: Record<BillingHistoryEvent["type"], string> = {
  subscription_created: "Subscription started",
  plan_changed: "Plan changed",
  payment_succeeded: "Payment succeeded",
  payment_failed: "Payment failed",
  past_due: "Marked past due",
  cancellation_requested: "Cancellation scheduled",
  cancelled: "Cancelled",
  reactivated: "Reactivated",
  expired: "Trial expired",
};

function formatPrice(pricing: Plan["pricing"], interval: "monthly" | "yearly"): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  const amount = (entry.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: entry.currency });
  return `${amount}/${interval === "monthly" ? "mo" : "yr"}`;
}

/**
 * Phase 25 — the agency-level counterpart to BillingPage.tsx, same minimal, no-invented-pricing
 * shape, pointed at /agencies/:agencyId/subscription instead of /businesses/:businessId/subscription.
 * No mock-advance/trial-conversion dev button here — that driver only exists for business
 * subscriptions today (billingMockDriver.controller.ts); the agency subscription path is proven
 * via Jest against the same real webhook/state-machine code, just not exposed as a UI shortcut yet.
 *
 * Phase 27 — gained plan pricing display, Billing History, past_due grace-period messaging, and a
 * "pay now" checkout path alongside the existing no-card trial path, mirroring BillingPage.tsx.
 */
export function AgencyBillingPage() {
  const { activeAgencyId } = useAgency();

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [pastDueDeadline, setPastDueDeadline] = useState<string | undefined>();
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [history, setHistory] = useState<BillingHistoryEvent[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    if (!activeAgencyId) return;
    const [subRes, plansRes, historyRes] = await Promise.all([
      apiClient.request<{ subscription: Subscription | null; plan: Plan | null; pastDueDeadline?: string }>(
        `/agencies/${activeAgencyId}/subscription`
      ),
      apiClient.request<{ plans: Plan[] }>("/plans"),
      apiClient.request<Paginated<BillingHistoryEvent>>(`/agencies/${activeAgencyId}/subscription/billing-history?limit=10`),
    ]);
    setSubscription(subRes.subscription);
    setPlan(subRes.plan);
    setPastDueDeadline(subRes.pastDueDeadline);
    const agencyPlans = plansRes.plans.filter((p) => p.type === "AGENCY");
    setAvailablePlans(agencyPlans);
    setHistory(historyRes.items);
    if (!selectedPlanCode && agencyPlans[0]) setSelectedPlanCode(agencyPlans[0].code);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/subscription`, {
        method: "POST",
        body: { planCode: selectedPlanCode, billingInterval },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.request<{ checkout: { mode: string; url?: string } }>(
        `/agencies/${activeAgencyId}/subscription/checkout`,
        { method: "POST", body: { planCode: selectedPlanCode, billingInterval } }
      );
      if (res.checkout.mode === "redirect" && res.checkout.url) {
        window.location.assign(res.checkout.url);
      } else {
        setError("This provider's checkout widget isn't wired into the admin app yet.");
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel this subscription? If it's active, it stays usable until the end of the current period."))
      return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/subscription/cancel`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function reactivate() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/subscription/reactivate`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function changePlan(planCode: string) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/subscription/change-plan`, { method: "POST", body: { planCode } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!activeAgencyId) return null;
  if (loading) return <p className="text-muted">Loading billing...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Agency billing</h1>
        <p className="text-sm text-muted">
          Your agency's subscription status. No real payment provider is connected yet — this runs against a mock
          billing system for now.
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {subscription && plan ? (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 font-heading text-lg font-medium text-foreground">
                {plan.name}
                <Badge tone={STATUS_TONE[subscription.status]}>{STATUS_LABEL[subscription.status]}</Badge>
              </p>
              <p className="text-sm text-muted">
                {formatPrice(plan.pricing, subscription.billingInterval) ?? (subscription.billingInterval === "monthly" ? "Billed monthly" : "Billed yearly")}
                {subscription.provider === "internal" && " · Platform-granted, no billing relationship"}
              </p>
            </div>
          </div>

          {subscription.status === "past_due" && pastDueDeadline && (
            <Alert tone="warning">
              Your last payment failed. Please update your payment method by{" "}
              {new Date(pastDueDeadline).toLocaleDateString()} to avoid losing access.
            </Alert>
          )}

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {subscription.trialEnd && subscription.status === "trialing" && (
              <div>
                <dt className="text-muted">Trial ends</dt>
                <dd className="text-foreground">{new Date(subscription.trialEnd).toLocaleDateString()}</dd>
              </div>
            )}
            <div>
              <dt className="text-muted">Current period ends</dt>
              <dd className="text-foreground">{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</dd>
            </div>
            {subscription.cancelAt && (
              <div>
                <dt className="text-muted">Cancels on</dt>
                <dd className="text-foreground">{new Date(subscription.cancelAt).toLocaleDateString()}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-wrap gap-3">
            {subscription.status === "cancelling" && (
              <Button size="sm" onClick={reactivate} disabled={busy}>
                Reactivate
              </Button>
            )}
            {["trialing", "active", "past_due"].includes(subscription.status) && (
              <button
                type="button"
                onClick={cancel}
                disabled={busy}
                className="text-sm font-medium text-danger hover:underline disabled:opacity-50"
              >
                Cancel subscription
              </button>
            )}
            {["trialing", "active", "past_due"].includes(subscription.status) &&
              availablePlans.filter((p) => p.code !== plan.code).length > 0 && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  Change plan:
                  <select
                    disabled={busy}
                    defaultValue=""
                    onChange={(e) => e.target.value && changePlan(e.target.value)}
                    className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Select a plan
                    </option>
                    {availablePlans
                      .filter((p) => p.code !== plan.code)
                      .map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col gap-4">
          <p className="text-sm text-muted">No subscription yet.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Plan
              <select
                value={selectedPlanCode}
                onChange={(e) => setSelectedPlanCode(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                {availablePlans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                    {formatPrice(p.pricing, billingInterval) ? ` — ${formatPrice(p.pricing, billingInterval)}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Billing interval
              <select
                value={billingInterval}
                onChange={(e) => setBillingInterval(e.target.value as "monthly" | "yearly")}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <Button size="sm" onClick={start} disabled={busy || !selectedPlanCode}>
              {busy ? "Starting..." : "Start subscription"}
            </Button>
            <Button size="sm" variant="secondary" onClick={checkout} disabled={busy || !selectedPlanCode}>
              Subscribe now
            </Button>
          </div>
        </Card>
      )}

      <Card className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-medium text-foreground">Billing history</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Nothing yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {history.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-foreground">{HISTORY_LABEL[e.type]}</span>
                <span className="text-muted">{new Date(e.occurredAt).toLocaleString()}</span>
                {e.amountCents !== undefined && e.currency && (
                  <span className="text-foreground">
                    {(e.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: e.currency })}
                  </span>
                )}
                {e.receiptUrl && (
                  <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                    Receipt
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
