import { useEffect, useState } from "react";
import type { Refund } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";

/** What the server says staff can do about a refund (payment.service.ts describeRefundForStaff). */
export interface RefundReconciliation {
  held: boolean;
  waitingOnProvider: boolean;
  canCheckWithProvider: boolean;
  canRetry: boolean;
  manualNotRefundedAvailableAt: string | null;
  nextAction: string | null;
}

export type StaffRefund = Refund & { reconciliation: RefundReconciliation };

type CheckOutcome = "already_final" | "in_progress" | "found" | "reissued" | "not_found" | "inconclusive" | "manual_required";

const CHECK_MESSAGE: Record<CheckOutcome, string> = {
  already_final: "This refund is already settled.",
  in_progress: "This refund is still being processed. Try again in a moment.",
  found: "Found at the provider — the refund now shows its real status.",
  reissued: "The provider had no record of this refund, so it was sent again with the same key.",
  not_found:
    "The provider has no record of this refund. Nothing was moved. If you're sure it didn't happen, you can confirm it below.",
  inconclusive: "The provider didn't give a clear answer. The refund stays on hold — try again later.",
  manual_required: "This provider can't be checked automatically. Check its dashboard and record what you find.",
};

function refundBadge(refund: StaffRefund): { tone: "neutral" | "info" | "warning" | "success" | "danger"; label: string } {
  if (refund.status === "succeeded") return { tone: "success", label: "Refunded" };
  if (refund.status === "failed") return { tone: "neutral", label: "Not refunded" };
  if (refund.reconciliation.held) return { tone: "danger", label: "On hold" };
  if (refund.reconciliation.waitingOnProvider) {
    return { tone: "warning", label: refund.providerStatus === "requires_action" ? "Waiting · action needed at provider" : "Waiting on provider" };
  }
  return { tone: "info", label: "Processing" };
}

/**
 * Every refund on one payment, with what to do about one that's waiting or on hold. The server
 * decides what's allowed (and enforces it again): checking only reads the provider's records;
 * marking "not refunded" — the only action that frees the reserved amount — needs evidence, an
 * explicit confirmation, a minimum hold and, where the provider supports it, a fresh "not found".
 */
export function PaymentRefunds({
  basePath,
  currency,
  reloadKey,
  onChanged,
}: {
  /** /restaurants/:id/orders/:orderId/payments/:paymentId */
  basePath: string;
  currency: string;
  reloadKey: number;
  onChanged: () => void;
}) {
  const [refunds, setRefunds] = useState<StaffRefund[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const { refunds } = await apiClient.request<{ refunds: StaffRefund[] }>(`${basePath}/refunds`);
      setRefunds(refunds);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, reloadKey]);

  if (error) return <p className="text-xs text-danger">Couldn't load refunds: {error}</p>;
  if (!refunds || refunds.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Refunds</p>
      {refunds.map((refund) => (
        <RefundRow
          key={refund.id}
          refund={refund}
          currency={currency}
          path={`${basePath}/refunds/${refund.id}`}
          onChanged={async () => {
            await load();
            onChanged();
          }}
        />
      ))}
    </div>
  );
}

export function RefundRow({
  refund,
  currency,
  path,
  onChanged,
  allowManual = true,
}: {
  refund: StaffRefund;
  currency: string;
  /** The refund's own API path; `${path}/check` etc. */
  path: string;
  onChanged: () => void | Promise<void>;
  /** Settling by hand stays with the restaurant's staff — the platform view only checks. */
  allowManual?: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [form, setForm] = useState<"refunded" | "not_refunded" | null>(null);
  const r = refund.reconciliation;
  const badge = refundBadge(refund);
  const waiting = refund.status === "pending" && (r.held || r.waitingOnProvider);

  async function run(action: "check" | "retry") {
    setBusy(action);
    setMessage(null);
    try {
      const { outcome } = await apiClient.request<{ outcome: CheckOutcome }>(`${path}/${action}`, { method: "POST" });
      setMessage({ tone: "info", text: CHECK_MESSAGE[outcome] });
      await onChanged();
    } catch (err) {
      setMessage({ tone: "danger", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        <span className="font-medium text-foreground">{formatCurrency(refund.amount, currency)}</span>
        <span className="text-muted">via {refund.provider}</span>
        {refund.providerStatus && refund.status === "pending" && <span className="text-muted">Provider status: {refund.providerStatus}</span>}
        {refund.providerRefundRef && <span className="text-muted">Ref: {refund.providerRefundRef}</span>}
        <span className="text-muted">{new Date(refund.createdAt).toLocaleString()}</span>
      </div>
      {refund.reason && <p className="text-muted">Reason: {refund.reason}</p>}
      {refund.resolution && (
        <p className="text-muted">
          Settled {refund.resolution.method === "manual" ? "by hand" : `by ${refund.resolution.method.replace("provider_", "provider ")}`}{" "}
          on {new Date(refund.resolution.resolvedAt).toLocaleString()}
          {refund.resolution.evidence ? ` — “${refund.resolution.evidence}”` : ""}
        </p>
      )}
      {waiting && r.nextAction && <p className="text-foreground">{r.nextAction}</p>}
      {waiting && refund.lastLookupAt && (
        <p className="text-muted">
          Last checked {new Date(refund.lastLookupAt).toLocaleString()}:{" "}
          {refund.lastLookupResult === "not_found" ? "no such refund at the provider" : refund.lastLookupResult === "found" ? "found" : "no clear answer"}
        </p>
      )}
      {message && (
        <Alert tone={message.tone} role={message.tone === "danger" ? "alert" : "status"} className="text-xs">
          {message.text}
        </Alert>
      )}
      {waiting && (
        <div className="flex flex-wrap gap-2">
          {r.canCheckWithProvider && (
            <Button size="sm" variant="secondary" onClick={() => run("check")} disabled={busy !== null}>
              {busy === "check" ? "Checking..." : `Check with ${refund.provider}`}
            </Button>
          )}
          {r.canRetry && (
            <Button size="sm" variant="secondary" onClick={() => run("retry")} disabled={busy !== null}>
              {busy === "retry" ? "Working..." : "Check, then retry if missing"}
            </Button>
          )}
          {allowManual && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setForm(form === "refunded" ? null : "refunded")}>
                It was refunded…
              </Button>
              {r.held && (
                <Button size="sm" variant="ghost" onClick={() => setForm(form === "not_refunded" ? null : "not_refunded")}>
                  It wasn't refunded…
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {waiting && form && (
        <ResolveForm
          outcome={form}
          refund={refund}
          currency={currency}
          path={path}
          onDone={async (text) => {
            setForm(null);
            setMessage({ tone: "info", text });
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function ResolveForm({
  outcome,
  refund,
  currency,
  path,
  onDone,
}: {
  outcome: "refunded" | "not_refunded";
  refund: StaffRefund;
  currency: string;
  path: string;
  onDone: (message: string) => void | Promise<void>;
}) {
  const [ref, setRef] = useState("");
  const [evidence, setEvidence] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = refund.reconciliation;
  const availableAt = r.manualNotRefundedAvailableAt ? new Date(r.manualNotRefundedAvailableAt) : null;
  const tooSoon = outcome === "not_refunded" && availableAt !== null && availableAt.getTime() > Date.now();

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await apiClient.request(`${path}/resolve`, {
        method: "POST",
        body: { outcome, evidence, confirmChecked: confirmed, ...(outcome === "refunded" ? { providerRefundRef: ref } : {}) },
      });
      await onDone(outcome === "refunded" ? "Recorded as refunded." : "Recorded as not refunded — the reserved amount is available again.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const valid = evidence.trim().length >= 10 && (outcome === "refunded" ? ref.trim().length >= 3 : confirmed);

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-surface p-2">
      {outcome === "refunded" ? (
        <>
          <p className="text-foreground">Find this refund in the {refund.provider} dashboard and copy its reference.</p>
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Provider refund reference (e.g. re_…)"
            className="rounded-md border border-border bg-background px-2 py-1"
          />
        </>
      ) : (
        <>
          <p className="text-foreground">
            Only do this if the {refund.provider} dashboard shows no refund for this payment. It frees the reserved{" "}
            {formatCurrency(refund.amount, currency)} so it can be refunded again.
            {r.canCheckWithProvider && ` ${refund.provider} must also report no such refund in a check from the last 15 minutes.`}
          </p>
          {tooSoon && availableAt && (
            <p className="text-warning">Available from {availableAt.toLocaleTimeString()} — the provider may still be finishing.</p>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>I checked the {refund.provider} dashboard and this refund doesn't exist there.</span>
          </label>
        </>
      )}
      <textarea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        placeholder="What did you check? (kept in the audit log)"
        rows={2}
        maxLength={1000}
        className="rounded-md border border-border bg-background px-2 py-1"
      />
      {error && (
        <Alert tone="danger" role="alert" className="text-xs">
          {error}
        </Alert>
      )}
      <div>
        <Button size="sm" onClick={submit} disabled={!valid || saving || tooSoon}>
          {saving ? "Saving..." : outcome === "refunded" ? "Record as refunded" : "Record as not refunded"}
        </Button>
      </div>
    </div>
  );
}
