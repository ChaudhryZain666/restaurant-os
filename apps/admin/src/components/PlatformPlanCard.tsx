import { useEffect, useState } from "react";
import type { BillingInterval, PlatformPlanOption, PlatformSubscriptionSummary } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";

const LIVE_STATUSES = ["trialing", "active", "past_due", "cancelling"];

const STATUS_TONE: Record<string, "success" | "neutral" | "danger" | "warning"> = {
  trialing: "neutral",
  active: "success",
  past_due: "warning",
  cancelling: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

function priceLabel(plan: PlatformPlanOption, interval: BillingInterval) {
  const price = plan.pricing.find((p) => p.interval === interval);
  if (!price || price.amountCents === undefined) return "no price set";
  return `${formatCurrency(price.amountCents / 100, price.currency)}/${interval === "monthly" ? "mo" : "yr"}`;
}

/**
 * Lane A — the business's plan, and (when it has no live subscription) assigning an existing
 * eligible plan, including a private client-specific one. Assignment starts a no-card trial through
 * the same lifecycle service an owner's own "Start trial" uses — nothing is charged, and an
 * existing subscription is never changed here. The owner converts the trial through checkout.
 */
export function PlatformPlanCard({
  businessId,
  subscription,
  onAssigned,
}: {
  businessId: string | undefined;
  subscription: PlatformSubscriptionSummary | null;
  onAssigned: () => Promise<unknown>;
}) {
  const [plans, setPlans] = useState<PlatformPlanOption[] | null>(null);
  const [planCode, setPlanCode] = useState("");
  const [interval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasLive = subscription !== null && LIVE_STATUSES.includes(subscription.status);
  const canAssign = Boolean(businessId) && !hasLive;

  useEffect(() => {
    if (!canAssign || plans) return;
    apiClient
      .request<{ items: PlatformPlanOption[] }>("/platform/plans")
      .then((data) => setPlans(data.items.filter((p) => p.type === "OWNER" && p.assignable)))
      .catch((err) => setError((err as Error).message));
  }, [canAssign, plans]);

  const selected = plans?.find((p) => p.code === planCode);

  async function assign() {
    if (!selected || !businessId) return;
    if (!window.confirm(`Start a ${selected.trialDays}-day trial of "${selected.name}" (${interval}) for this business? Nothing is charged.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/platform/businesses/${businessId}/subscription`, {
        method: "POST",
        body: { planCode: selected.code, billingInterval: interval },
      });
      setNotice(`Trial of ${selected.name} started.`);
      setPlanCode("");
      await onAssigned();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Plan</h2>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}

      {subscription && (
        <dl className="mb-3 flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Plan</dt>
            <dd className="text-right text-foreground">{subscription.planName ?? subscription.planCode ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Status</dt>
            <dd>
              <Badge tone={STATUS_TONE[subscription.status] ?? "neutral"}>{subscription.status.replace("_", " ")}</Badge>
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Billing</dt>
            <dd className="text-foreground">{subscription.billingInterval}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">{subscription.status === "trialing" ? "Trial ends" : "Current period ends"}</dt>
            <dd className="text-foreground">
              {new Date(subscription.trialEnd ?? subscription.currentPeriodEnd).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      )}

      {!businessId ? (
        <p className="text-sm text-muted">This restaurant isn't linked to a business, so no plan can be assigned.</p>
      ) : hasLive ? (
        <p className="text-xs text-muted">Plan changes and cancellations stay with the owner's billing page.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted">
            {subscription ? "No live plan. " : "No plan yet. "}
            Assign one to start a free trial — the owner adds payment through checkout before it ends. Only plans with a trial
            are listed; private client plans are marked.
          </p>
          {plans === null ? (
            !error && <p className="text-sm text-muted">Loading plans...</p>
          ) : plans.length === 0 ? (
            <p className="text-sm text-muted">No active plan with a trial is available.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Plan
                <select className={inputClass} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                  <option value="">Choose a plan</option>
                  {plans.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                      {p.isPubliclyListed ? "" : " (private)"} — {priceLabel(p, interval)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Billing
                <select className={inputClass} value={interval} onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
              <Button size="sm" onClick={assign} disabled={!selected || busy}>
                {busy ? "Starting..." : "Start trial"}
              </Button>
            </div>
          )}
          {selected && !selected.pricing.find((p) => p.interval === interval)?.hasCheckoutPrice && (
            <p className="text-xs text-warning">
              This plan has no checkout price for {interval} billing yet, so the owner couldn't convert the trial to paid until
              one is configured.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
