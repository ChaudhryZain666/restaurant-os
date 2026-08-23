import { useEffect, useState } from "react";
import type { Plan, Subscription } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

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

/**
 * Phase 24 — deliberately minimal owner-facing billing surface: no polished pricing page, no
 * final commercial pricing (Plan.pricing entries may have no amountCents at all — see
 * packages/types/src/types/plan.ts). Shows real, server-authoritative subscription state and the
 * mock-provider-backed lifecycle actions; nothing here is invented or simulated client-side.
 */
export function BillingPage() {
  const { user } = useAuth();
  const businessId = user!.businessId!;

  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [selectedPlanCode, setSelectedPlanCode] = useState("");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    const [subRes, plansRes] = await Promise.all([
      apiClient.request<{ subscription: Subscription | null; plan: Plan | null }>(`/businesses/${businessId}/subscription`),
      apiClient.request<{ plans: Plan[] }>("/plans"),
    ]);
    setSubscription(subRes.subscription);
    setPlan(subRes.plan);
    setAvailablePlans(plansRes.plans);
    if (!selectedPlanCode && plansRes.plans[0]) setSelectedPlanCode(plansRes.plans[0].code);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/subscription`, {
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

  async function cancel() {
    if (!window.confirm("Cancel this subscription? If it's active, it stays usable until the end of the current period."))
      return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/subscription/cancel`, { method: "POST" });
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
      await apiClient.request(`/businesses/${businessId}/subscription/reactivate`, { method: "POST" });
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
      await apiClient.request(`/businesses/${businessId}/subscription/change-plan`, { method: "POST", body: { planCode } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Dev/test-only — no real billing provider is integrated (see MockBillingProvider.ts), so
  // there's no real trial-conversion event to wait for. Drives the same signature-verified event
  // path a genuine webhook would (billingMockDriver.controller.ts), not a shortcut around it. Only
  // reachable when the API is actually configured with BILLING_PROVIDER=mock — the button simply
  // 404s otherwise, so it can never be mistaken for a real integration.
  async function simulateTrialConversion() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.request(`/businesses/${businessId}/subscription/mock-advance`, { method: "POST", body: { status: "active" } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-muted">Loading billing...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Billing</h1>
        <p className="text-sm text-muted">
          Your subscription status. No real payment provider is connected yet — this runs against a mock billing
          system for now.
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
                {subscription.billingInterval === "monthly" ? "Billed monthly" : "Billed yearly"}
                {subscription.provider === "internal" && " · Platform-granted, no billing relationship"}
              </p>
            </div>
          </div>

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
            {subscription.status === "trialing" && (
              <Button size="sm" onClick={simulateTrialConversion} disabled={busy}>
                Simulate trial conversion (dev)
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
          </div>
        </Card>
      )}
    </div>
  );
}
