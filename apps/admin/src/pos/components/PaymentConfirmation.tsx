import { useState } from "react";
import type { Order } from "@restaurant/types";
import { Alert, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../../lib/api";
import { IconBanknote, IconCreditCard } from "../../components/icons";
import type { PosPaymentMethod } from "../types";
import { TerminalCardPayment } from "./TerminalCardPayment";

/**
 * Phase 73 — the order this renders for already exists but is deliberately still `unpaid`
 * (RegisterPage now always sends `markPaidImmediately: false`): before this phase, tapping
 * "Charge $X"/"Take $X cash" created an ALREADY-paid order in one click, for both payment
 * methods, with no confirmation step at all — a mis-tap instantly marked a sale paid with zero
 * verification. This screen is the fix, and it's the same shape for both methods: show the
 * server-computed total (never a client estimate), require an explicit staff confirmation, and
 * only then call the existing PATCH .../payment-status endpoint. No new backend capability —
 * every request this component makes already existed and is already exercised by the manual
 * paid/unpaid toggle elsewhere in the admin.
 *
 * Cash gets a real received-amount/change-due calculator (Section 14) so a cashier can't
 * "Complete payment" against an insufficient amount. Card is honest about what's actually
 * available: when this location has no real card-terminal provider configured (the default,
 * everywhere, today), it keeps Phase 73's explicit staff-confirmation step — "Payment approved" is
 * staff attesting a SEPARATE physical terminal/card machine already approved the charge, not this
 * software confirming anything itself. When a terminal genuinely IS configured (Phase 74 —
 * currently only ever the mock provider, test/dev-only), the flow hands off to
 * TerminalCardPayment.tsx, which drives a real create/poll state machine instead of a bare
 * attestation button. Declining/cancelling either path cancels the still-pending order (existing
 * PATCH .../status, "cancelled" is always a valid transition out of "pending") rather than leaving
 * an abandoned unpaid order behind.
 */
export function PaymentConfirmation({
  order,
  restaurantId,
  paymentMethod,
  terminalConfigured,
  onConfirmed,
  onCancelled,
}: {
  order: Order;
  restaurantId: string;
  paymentMethod: PosPaymentMethod;
  /** Phase 74 — true only when BOTH env.POS_TERMINAL_PROVIDER !== "none" (deployment-level) AND
   *  this location's own settings.posTerminalEnabled are set. See RegisterPage.tsx's computation. */
  terminalConfigured: boolean;
  onConfirmed: (order: Order) => void;
  onCancelled: () => void;
}) {
  const [cashReceivedInput, setCashReceivedInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cashReceived = Number(cashReceivedInput);
  const cashValid = cashReceivedInput.trim() !== "" && Number.isFinite(cashReceived) && cashReceived >= order.total;
  const changeDue = cashValid ? Math.round((cashReceived - order.total) * 100) / 100 : 0;

  async function markPaid() {
    setSubmitting(true);
    setError(null);
    try {
      const { order: updated } = await apiClient.request<{ order: Order }>(
        `/restaurants/${restaurantId}/orders/${order.id}/payment-status`,
        { method: "PATCH", body: { paymentStatus: "paid" } }
      );
      onConfirmed(updated);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  async function cancelSale() {
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status: "cancelled" },
      });
      onCancelled();
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        {paymentMethod === "cash" ? <IconBanknote className="h-6 w-6" /> : <IconCreditCard className="h-6 w-6" />}
      </span>
      <div>
        <p className="text-sm text-muted">Order #{order.orderNumber}</p>
        <p className="font-heading text-3xl font-semibold text-foreground">{formatCurrency(order.total, order.currency)}</p>
      </div>

      {paymentMethod === "cash" ? (
        <div className="flex w-full max-w-xs flex-col gap-3 text-left">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            Cash received
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              autoFocus
              value={cashReceivedInput}
              onChange={(e) => setCashReceivedInput(e.target.value)}
              placeholder={formatCurrency(order.total, order.currency)}
              className="rounded-lg border border-border bg-background px-3 py-2.5 text-lg font-medium text-foreground"
            />
          </label>
          <div className="flex items-center justify-between rounded-lg bg-black/[0.03] px-3.5 py-2.5 text-sm">
            <span className="text-muted">Change due</span>
            <span className="font-heading font-semibold tabular-nums text-foreground">
              {cashValid ? formatCurrency(changeDue, order.currency) : "—"}
            </span>
          </div>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button size="lg" disabled={!cashValid || submitting} onClick={markPaid}>
            {submitting ? "Completing sale..." : "Complete payment"}
          </Button>
          <button onClick={cancelSale} disabled={submitting} className="text-xs font-medium text-muted hover:text-foreground">
            Cancel sale
          </button>
        </div>
      ) : terminalConfigured ? (
        <TerminalCardPayment order={order} restaurantId={restaurantId} onConfirmed={onConfirmed} onCancelled={onCancelled} />
      ) : (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <p className="text-sm text-muted">
            Charge {formatCurrency(order.total, order.currency)} on your card terminal, then confirm the result here.
          </p>
          {error && (
            <Alert tone="danger" role="alert">
              {error}
            </Alert>
          )}
          <Button size="lg" disabled={submitting} onClick={markPaid}>
            {submitting ? "Completing sale..." : "Payment approved"}
          </Button>
          <button onClick={cancelSale} disabled={submitting} className="text-xs font-medium text-muted hover:text-foreground">
            Payment declined / cancel sale
          </button>
        </div>
      )}
    </div>
  );
}
