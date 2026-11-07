import { useCallback, useEffect, useState } from "react";
import type {
  BillingHistoryEvent,
  BillingInterval,
  PlatformPlanOption,
  PlatformSubscriptionSummary,
  SubscriptionBillingSource,
  SubscriptionOwnerType,
} from "@restaurant/types";
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

/** Where the money comes from — the one thing a platform admin must never misread. */
const SOURCE_LABEL: Record<SubscriptionBillingSource, { label: string; tone: "success" | "neutral" | "info" | "warning" }> = {
  lemonsqueezy: { label: "Paid · Lemon Squeezy", tone: "success" },
  paddle: { label: "Paid · Paddle", tone: "success" },
  mock: { label: "Development billing", tone: "warning" },
  manual_offline: { label: "Manual · billed offline", tone: "info" },
  complimentary: { label: "Complimentary", tone: "info" },
  trial: { label: "Free trial · no card", tone: "neutral" },
  internal: { label: "Grandfathered", tone: "neutral" },
};

const HISTORY_LABEL: Partial<Record<BillingHistoryEvent["type"], string>> = {
  trial_started: "Trial started",
  subscription_created: "Subscription created",
  plan_changed: "Plan changed",
  payment_succeeded: "Payment received",
  payment_failed: "Payment failed",
  past_due: "Past due",
  cancellation_requested: "Set to cancel",
  cancelled: "Cancelled",
  reactivated: "Reactivated",
  expired: "Ended",
  refunded: "Refunded",
  chargeback: "Chargeback",
  chargeback_reversed: "Chargeback reversed",
  subscription_extended: "End date extended",
  suspended: "Suspended",
};

type CreateMode = "complimentary" | "offline" | "trial";
type Panel = null | "create" | "extend" | "change" | "suspend" | "cancel";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";
const labelClass = "flex flex-col gap-1 text-xs text-muted";

const DAY_MS = 24 * 60 * 60 * 1000;
const toDateInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
/** A chosen end date runs to the end of that day, in the admin's own time zone. */
const endOfDayIso = (date: string) => new Date(`${date}T23:59:59`).toISOString();
const startOfDayIso = (date: string) => new Date(`${date}T00:00:00`).toISOString();
const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dollarsToCents = (value: string) => Math.round(Number(value) * 100);
/** An offline-billed price: above zero (a free plan is complimentary). */
const isPrice = (value: string) => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) > 0;

function listPrice(plan: PlatformPlanOption | undefined, interval: BillingInterval) {
  return plan?.pricing.find((p) => p.interval === interval);
}

function priceLabel(plan: PlatformPlanOption, interval: BillingInterval) {
  const price = listPrice(plan, interval);
  if (!price || price.amountCents === undefined) return "no price set";
  return `${formatCurrency(price.amountCents / 100, price.currency)}/${interval === "monthly" ? "mo" : "yr"}`;
}

function agreedLabel(sub: PlatformSubscriptionSummary) {
  if (!sub.manualBilling) return null;
  if (sub.manualBilling.kind === "complimentary") return "Free (complimentary)";
  const per = sub.billingInterval === "monthly" ? "month" : "year";
  return `${formatCurrency(sub.manualBilling.amountCents / 100, sub.manualBilling.currency)} per ${per}, invoiced outside GarnishTable`;
}

function historyDetail(event: BillingHistoryEvent): string | null {
  const m = (event.metadata ?? {}) as Record<string, unknown>;
  if (event.type === "subscription_extended" && typeof m.to === "string") return `to ${formatDate(m.to)}`;
  if (event.type === "suspended" && typeof m.reason === "string") return m.reason;
  if (event.type === "reactivated" && m.from === "suspended") return "after suspension";
  if (event.type === "reactivated" && m.from === "cancelling") return "cancellation withdrawn";
  if (typeof m.newPlanCode === "string") return `to ${m.newPlanCode}`;
  if (m.kind === "complimentary") return "complimentary";
  if (m.kind === "offline" && typeof m.agreedAmountCents === "number") {
    return `offline, ${formatCurrency(m.agreedAmountCents / 100, typeof m.currency === "string" ? m.currency : "USD")} agreed`;
  }
  if (event.amountCents !== undefined && event.amountCents !== null) return formatCurrency(event.amountCents / 100, event.currency ?? "USD");
  return null;
}

/**
 * A business's or agency's plan for a platform admin: where it is billed, its terms and dates, its
 * history, and every action a platform admin may take on it.
 *
 * - No live plan: a manual subscription (complimentary, or billed offline at the list or a negotiated
 *   price, with explicit start and end dates), or a free no-card trial the owner converts through
 *   checkout. A manual subscription never touches a billing provider or records a payment.
 * - A live no-card trial can be replaced by a manual subscription, or ended.
 * - A manual subscription can be extended, changed, suspended, cancelled and resumed.
 * - A provider-paid subscription stays the owner's to change; a platform admin can only schedule
 *   its cancellation at the end of the paid period.
 */
export function PlatformPlanCard({
  ownerType,
  ownerId,
  onChanged,
}: {
  ownerType: SubscriptionOwnerType;
  ownerId: string | undefined;
  onChanged?: () => Promise<unknown> | void;
}) {
  const base = ownerType === "agency" ? `/platform/agencies/${ownerId}` : `/platform/businesses/${ownerId}`;
  const planType = ownerType === "agency" ? "AGENCY" : "OWNER";

  const [subscription, setSubscription] = useState<PlatformSubscriptionSummary | null>(null);
  const [history, setHistory] = useState<BillingHistoryEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [plans, setPlans] = useState<PlatformPlanOption[] | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Form state — one form is open at a time.
  const [mode, setMode] = useState<CreateMode>("complimentary");
  const [planCode, setPlanCode] = useState("");
  const [interval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [price, setPrice] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [startsOn, setStartsOn] = useState(toDateInput(new Date()));
  const [endsOn, setEndsOn] = useState(toDateInput(new Date(Date.now() + 31 * DAY_MS)));
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [cancelWhen, setCancelWhen] = useState<"period_end" | "immediately">("period_end");

  const load = useCallback(async () => {
    if (!ownerId) return;
    try {
      const data = await apiClient.request<{ items: BillingHistoryEvent[]; subscription: PlatformSubscriptionSummary | null }>(
        `${base}/billing-history?limit=20`
      );
      setSubscription(data.subscription);
      setHistory(data.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [base, ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (plans || !ownerId) return;
    apiClient
      .request<{ items: PlatformPlanOption[] }>("/platform/plans")
      .then((data) => setPlans(data.items.filter((p) => p.type === planType)))
      .catch((err) => setError((err as Error).message));
  }, [plans, ownerId, planType]);

  const hasLive = subscription !== null && LIVE_STATUSES.includes(subscription.status);
  const isManual = subscription?.provider === "manual";
  const isLocalTrial = hasLive && subscription?.billingSource === "trial";
  const selected = plans?.find((p) => p.code === planCode);
  const selectedListPrice = listPrice(selected, interval);
  const priceCurrency = selectedListPrice?.currency ?? subscription?.manualBilling?.currency ?? "USD";

  // The agreed price follows the chosen plan's list price until the admin types their own.
  useEffect(() => {
    if (priceTouched) return;
    setPrice(selectedListPrice?.amountCents !== undefined ? (selectedListPrice.amountCents / 100).toFixed(2) : "");
  }, [selectedListPrice, priceTouched]);

  function open(next: Panel) {
    setPanel(next);
    setError(null);
    setNotice(null);
    setNote("");
    setReason("");
    setPriceTouched(false);
    if (next === "create") {
      setMode("complimentary");
      setPlanCode("");
      setBillingInterval("monthly");
      setStartsOn(toDateInput(new Date()));
      setEndsOn(toDateInput(new Date(Date.now() + 31 * DAY_MS)));
    }
    if (next === "change" && subscription) {
      setPlanCode(subscription.planCode ?? "");
      setBillingInterval(subscription.billingInterval);
    }
    if (next === "extend" && subscription) {
      const end = new Date(subscription.currentPeriodEnd);
      end.setMonth(end.getMonth() + (subscription.billingInterval === "yearly" ? 12 : 1));
      setEndsOn(toDateInput(end));
    }
    if (next === "cancel") setCancelWhen("period_end");
  }

  async function run(failure: string, path: string, body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(path, { method: "POST", body });
      setNotice(done);
      setPanel(null);
      await load();
      await onChanged?.();
    } catch (err) {
      setError(`${failure}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function submitCreate() {
    if (!selected) return;
    if (mode === "trial") {
      void run("Couldn't start the trial", `${base}/subscription`, { planCode: selected.code, billingInterval: interval }, `Free trial of ${selected.name} started.`);
      return;
    }
    const today = toDateInput(new Date());
    void run(
      "Couldn't create the subscription",
      `${base}/subscription/manual`,
      {
        planCode: selected.code,
        billingInterval: interval,
        kind: mode,
        endsAt: endOfDayIso(endsOn),
        ...(startsOn && startsOn !== today ? { startsAt: startOfDayIso(startsOn) } : {}),
        ...(mode === "offline" ? { amountCents: dollarsToCents(price) } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      `${mode === "complimentary" ? "Complimentary" : "Offline-billed"} ${selected.name} subscription created.`
    );
  }

  if (!ownerId) {
    return (
      <Card>
        <h2 className="mb-2 font-heading text-sm font-semibold text-foreground">Plan & billing</h2>
        <p className="text-sm text-muted">This restaurant isn't linked to a business, so no plan can be assigned.</p>
      </Card>
    );
  }

  const subPath = subscription ? `/platform/subscriptions/${subscription.id}` : "";
  const source = subscription ? SOURCE_LABEL[subscription.billingSource] : null;
  const lapsed = Boolean(subscription && hasLive && !subscription.isLive && !subscription.suspendedAt);
  const datesInvalid = !endsOn || endOfDayIso(endsOn) <= new Date().toISOString() || Boolean(startsOn && startsOn > endsOn);
  const createBlocked = !selected || busy || (mode === "offline" && !isPrice(price)) || (mode !== "trial" && datesInvalid) || (mode === "trial" && !selected?.assignable);

  return (
    <Card role="region" aria-label="Plan & billing">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">Plan & billing</h2>
        {source && <Badge tone={source.tone}>{source.label}</Badge>}
      </div>

      {error && (
        <Alert tone="danger" role="alert" className="mb-3">
          {error}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-3">
          {notice}
        </Alert>
      )}

      {!loaded ? (
        <p className="text-sm text-muted">Loading plan...</p>
      ) : subscription ? (
        <dl className="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Plan</dt>
          <dd className="text-right text-foreground">{subscription.planName ?? subscription.planCode ?? "—"}</dd>
          <dt className="text-muted">Status</dt>
          <dd className="flex flex-wrap justify-end gap-1">
            <Badge tone={STATUS_TONE[subscription.status] ?? "neutral"}>{subscription.status.replace("_", " ")}</Badge>
            {subscription.suspendedAt && <Badge tone="danger">Suspended</Badge>}
            {lapsed && <Badge tone="danger">Ended — no access</Badge>}
          </dd>
          <dt className="text-muted">Billing</dt>
          <dd className="text-right capitalize text-foreground">{subscription.billingInterval}</dd>
          {agreedLabel(subscription) && (
            <>
              <dt className="text-muted">Agreed price</dt>
              <dd className="text-right text-foreground">{agreedLabel(subscription)}</dd>
            </>
          )}
          <dt className="text-muted">{subscription.status === "trialing" ? "Trial" : "Term"}</dt>
          <dd className="text-right tabular-nums text-foreground">
            {formatDate(subscription.currentPeriodStart)} – {formatDate(subscription.trialEnd ?? subscription.currentPeriodEnd)}
          </dd>
          {subscription.cancelAt && (
            <>
              <dt className="text-muted">Cancels on</dt>
              <dd className="text-right tabular-nums text-foreground">{formatDate(subscription.cancelAt)}</dd>
            </>
          )}
          {subscription.suspendedReason && (
            <>
              <dt className="text-muted">Suspended for</dt>
              <dd className="text-right text-foreground">{subscription.suspendedReason}</dd>
            </>
          )}
          {subscription.manualBilling?.note && (
            <>
              <dt className="text-muted">Admin note</dt>
              <dd className="text-right text-foreground">{subscription.manualBilling.note}</dd>
            </>
          )}
        </dl>
      ) : (
        <p className="mb-3 text-sm text-muted">No plan yet.</p>
      )}

      {loaded && panel === null && (
        <div className="flex flex-wrap gap-2">
          {(!hasLive || isLocalTrial) && (
            <Button size="sm" onClick={() => open("create")}>
              {isLocalTrial ? "Replace trial with a plan" : "Set up a plan"}
            </Button>
          )}
          {isManual && subscription?.status === "active" && (
            <>
              <Button size="sm" variant="outline" onClick={() => open("extend")}>
                Extend
              </Button>
              <Button size="sm" variant="outline" onClick={() => open("change")}>
                Change plan
              </Button>
            </>
          )}
          {isManual && hasLive && !subscription?.suspendedAt && (
            <Button size="sm" variant="outline" onClick={() => open("suspend")}>
              Suspend
            </Button>
          )}
          {isManual && hasLive && subscription?.suspendedAt && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("Couldn't unsuspend", `${subPath}/unsuspend`, {}, "Subscription unsuspended.")}>
              Unsuspend
            </Button>
          )}
          {isManual && subscription?.status === "cancelling" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("Couldn't resume", `${subPath}/resume`, {}, "Cancellation withdrawn.")}>
              Resume
            </Button>
          )}
          {hasLive && subscription?.status !== "cancelling" && (
            <Button size="sm" variant="ghost" onClick={() => open("cancel")}>
              {isLocalTrial ? "End trial" : "Cancel plan"}
            </Button>
          )}
        </div>
      )}

      {hasLive && !isManual && !isLocalTrial && panel === null && (
        <p className="mt-2 text-xs text-muted">
          Paid through the billing provider. Plan changes stay with the owner's billing page; you can only schedule its
          cancellation for the end of the paid period.
        </p>
      )}

      {panel === "create" && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="mb-1 text-xs text-muted">How is this plan paid?</legend>
            {(
              [
                ["complimentary", "Complimentary", "Free for the term you set."],
                ["offline", "Billed offline", "You invoice them at an agreed price."],
                ...(isLocalTrial ? [] : [["trial", "Free trial", "No card now; the owner pays through checkout."]]),
              ] as Array<[CreateMode, string, string]>
            ).map(([value, label, help]) => (
              <label
                key={value}
                className={`flex min-w-[10rem] flex-1 cursor-pointer flex-col gap-0.5 rounded-lg border p-2 text-sm ${
                  mode === value ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <span className="flex items-center gap-2 font-medium text-foreground">
                  <input type="radio" name={`plan-mode-${ownerId}`} checked={mode === value} onChange={() => setMode(value)} />
                  {label}
                </span>
                <span className="text-xs text-muted">{help}</span>
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap items-end gap-2">
            <label className={labelClass}>
              Plan
              <select className={inputClass} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                <option value="">Choose a plan</option>
                {(plans ?? [])
                  .filter((p) => mode !== "trial" || p.assignable)
                  .map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                      {p.isPubliclyListed ? "" : " (private)"} — {priceLabel(p, interval)}
                    </option>
                  ))}
              </select>
            </label>
            <label className={labelClass}>
              Billing
              <select className={inputClass} value={interval} onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            {mode === "offline" && (
              <label className={labelClass}>
                Agreed price ({priceCurrency})
                <input
                  className={`${inputClass} w-28 tabular-nums`}
                  inputMode="decimal"
                  value={price}
                  aria-invalid={!isPrice(price)}
                  onChange={(e) => {
                    setPriceTouched(true);
                    setPrice(e.target.value);
                  }}
                />
              </label>
            )}
          </div>

          {mode !== "trial" && (
            <div className="flex flex-wrap items-end gap-2">
              <label className={labelClass}>
                Starts
                <input type="date" className={inputClass} value={startsOn} max={toDateInput(new Date())} onChange={(e) => setStartsOn(e.target.value)} />
              </label>
              <label className={labelClass}>
                Ends
                <input type="date" className={inputClass} value={endsOn} min={toDateInput(new Date(Date.now() + DAY_MS))} onChange={(e) => setEndsOn(e.target.value)} />
              </label>
              <label className={`${labelClass} min-w-[12rem] flex-1`}>
                Admin note (platform admins only)
                <input className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Launch partner, 12-month agreement" />
              </label>
            </div>
          )}

          <p className="text-xs text-muted">
            {mode === "trial"
              ? "Nothing is charged. The owner converts the trial through checkout before it ends."
              : mode === "complimentary"
                ? "Nothing is charged or recorded as a payment. Access ends on the end date unless you extend it."
                : "GarnishTable records the agreement only — no payment is taken or recorded. Access ends on the end date unless you extend it."}
            {isLocalTrial && " This replaces the current free trial."}
          </p>

          <div className="flex gap-2">
            <Button size="sm" onClick={submitCreate} disabled={createBlocked}>
              {busy ? "Saving..." : mode === "trial" ? "Start trial" : "Create subscription"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "extend" && subscription && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className={labelClass}>
              New end date
              <input
                type="date"
                className={inputClass}
                value={endsOn}
                min={toDateInput(new Date(new Date(subscription.currentPeriodEnd).getTime() + DAY_MS))}
                onChange={(e) => setEndsOn(e.target.value)}
              />
            </label>
            <label className={`${labelClass} min-w-[12rem] flex-1`}>
              Admin note
              <input className={inputClass} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !endsOn}
              onClick={() =>
                void run(
                  "Couldn't extend",
                  `${subPath}/extend`,
                  { endsAt: endOfDayIso(endsOn), ...(note.trim() ? { note: note.trim() } : {}) },
                  `Extended to ${formatDate(endOfDayIso(endsOn))}.`
                )
              }
            >
              {busy ? "Saving..." : "Extend"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "change" && subscription && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className={labelClass}>
              Plan
              <select className={inputClass} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                {(plans ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                    {p.isPubliclyListed ? "" : " (private)"} — {priceLabel(p, interval)}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              Billing
              <select className={inputClass} value={interval} onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            {subscription.manualBilling?.kind === "offline" && (
              <label className={labelClass}>
                Agreed price ({priceCurrency})
                <input
                  className={`${inputClass} w-28 tabular-nums`}
                  inputMode="decimal"
                  value={price}
                  aria-invalid={!isPrice(price)}
                  onChange={(e) => {
                    setPriceTouched(true);
                    setPrice(e.target.value);
                  }}
                />
              </label>
            )}
          </div>
          <p className="text-xs text-muted">The term dates stay the same. Nothing is charged.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || !selected || (subscription.manualBilling?.kind === "offline" && !isPrice(price))}
              onClick={() =>
                void run(
                  "Couldn't change the plan",
                  `${subPath}/change-plan`,
                  {
                    planCode,
                    billingInterval: interval,
                    ...(subscription.manualBilling?.kind === "offline" ? { amountCents: dollarsToCents(price) } : {}),
                  },
                  `Plan changed to ${selected?.name ?? planCode}.`
                )
              }
            >
              {busy ? "Saving..." : "Change plan"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "suspend" && subscription && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <label className={labelClass}>
            Reason (the owner sees this in their billing history)
            <input className={inputClass} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Invoice INV-104 unpaid" />
          </label>
          <p className="text-xs text-muted">Plan features stop now and return when you unsuspend. The end date doesn't change.</p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || !reason.trim()}
              onClick={() => void run("Couldn't suspend", `${subPath}/suspend`, { reason: reason.trim() }, "Subscription suspended.")}
            >
              {busy ? "Suspending..." : "Suspend"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "cancel" && subscription && (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          {isManual ? (
            <fieldset className="flex flex-col gap-1 text-sm text-foreground">
              <legend className="mb-1 text-xs text-muted">When should it end?</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name={`cancel-when-${ownerId}`} checked={cancelWhen === "period_end"} onChange={() => setCancelWhen("period_end")} />
                At the end of the term ({formatDate(subscription.currentPeriodEnd)})
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={`cancel-when-${ownerId}`} checked={cancelWhen === "immediately"} onChange={() => setCancelWhen("immediately")} />
                Now — plan features stop immediately
              </label>
            </fieldset>
          ) : (
            <p className="text-sm text-foreground">
              {isLocalTrial
                ? "The free trial ends now."
                : subscription.status === "past_due"
                  ? "Its last payment failed, so plan features end now and the billing provider stops trying to charge it."
                  : `Cancellation is scheduled with the billing provider for ${formatDate(subscription.currentPeriodEnd)}. The owner keeps the period they've paid for.`}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(
                  "Couldn't cancel",
                  `${subPath}/cancel`,
                  { when: isManual ? cancelWhen : isLocalTrial ? "immediately" : "period_end" },
                  isLocalTrial ? "Trial ended." : "Cancellation recorded."
                )
              }
            >
              {busy ? "Saving..." : isLocalTrial ? "End trial" : "Cancel plan"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanel(null)} disabled={busy}>
              Keep plan
            </Button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">Billing history ({history.length})</summary>
          <ol className="mt-2 flex flex-col gap-1.5 text-sm">
            {history.map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-foreground">
                  {HISTORY_LABEL[event.type] ?? event.type}
                  {historyDetail(event) && <span className="text-muted"> · {historyDetail(event)}</span>}
                </span>
                <span className="text-xs tabular-nums text-muted">
                  {formatDate(event.occurredAt)} · {event.provider}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
