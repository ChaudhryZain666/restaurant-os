import { useEffect, useState } from "react";
import type { Order, Payment } from "@restaurant/types";
import { roleHasPermission } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const STATUS_TONE: Record<Payment["status"], "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "neutral",
  requires_action: "warning",
  authorized: "info",
  paid: "success",
  failed: "danger",
  cancelled: "neutral",
  refunded: "neutral",
  partially_refunded: "warning",
};

// A refunded payment WAS still a real successful payment — "refunded" alone reads ambiguously
// (as if nothing was ever paid), so refund states get an explicit "Paid · ..." prefix rather than
// just the bare status word.
const STATUS_LABEL: Record<Payment["status"], string> = {
  pending: "Pending",
  requires_action: "Requires action",
  authorized: "Authorized",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  refunded: "Paid · Refunded",
  partially_refunded: "Paid · Partially refunded",
};

/** Read-only payment visibility (method/status/amount/reference) plus a refund action gated by
 *  restaurant.payments.manage — the server enforces that permission independently regardless of
 *  what this component chooses to render, so this check is purely a UX convenience. */
export function OrderPaymentAdmin({ order }: { order: Order }) {
  const { user } = useAuth();
  const canRefund = user ? roleHasPermission(user.role, "restaurant.payments.manage") : false;

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");

  async function load() {
    setLoading(true);
    try {
      const { payments } = await apiClient.request<{ payments: Payment[] }>(
        `/restaurants/${order.restaurantId}/orders/${order.id}/payments`
      );
      setPayment(payments[0] ?? null); // server sorts newest first
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  async function submitRefund() {
    if (!payment) return;
    setRefunding(true);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${order.restaurantId}/orders/${order.id}/payments/${payment.id}/refund`, {
        method: "POST",
        body: {
          idempotencyKey: crypto.randomUUID(),
          amount: refundAmount ? Number(refundAmount) : undefined,
          reason: refundReason || undefined,
        },
      });
      setRefundOpen(false);
      setRefundAmount("");
      setRefundReason("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefunding(false);
    }
  }

  if (loading) return <p className="text-xs text-muted">Loading payment...</p>;
  if (!payment) return <p className="text-xs text-muted">No payment attempt yet.</p>;

  // Cancelling an order never auto-refunds its payment (Phase 17 product decision: refunds are a
  // deliberate, explicit staff action — see docs/api.md's "Paid-order cancellation" section for
  // why). A cancelled order whose payment is still fully/partially unrefunded is exactly the state
  // that decision leaves behind, so it needs to be impossible to miss rather than only visible to
  // someone who happens to expand this section and read the badge.
  const needsRefundAttention = order.status === "cancelled" && (payment.status === "paid" || payment.status === "partially_refunded");

  return (
    <div className="flex flex-col gap-1.5">
      {error && (
        <Alert tone="danger" role="alert" className="text-xs">
          {error}
        </Alert>
      )}
      {needsRefundAttention && (
        <Alert tone="warning" className="text-xs">
          This order was cancelled but the payment hasn't been refunded yet.
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span>Online payment</span>
        <Badge tone={STATUS_TONE[payment.status]}>{STATUS_LABEL[payment.status]}</Badge>
        <span className="text-muted">{formatCurrency(payment.amount, payment.currency)}</span>
        {payment.providerRef && <span className="text-muted">Ref: {payment.providerRef}</span>}
      </div>

      {canRefund && (payment.status === "paid" || payment.status === "partially_refunded") && (
        <div>
          {!refundOpen ? (
            <button onClick={() => setRefundOpen(true)} className="text-danger hover:underline">
              Issue refund
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
              <input
                type="number"
                min="0"
                step="0.01"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder={`Full refund (${formatCurrency(payment.amount, payment.currency)}) if left blank`}
                className="rounded-md border border-border bg-background px-2 py-1"
              />
              <input
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                placeholder="Reason (optional)"
                className="rounded-md border border-border bg-background px-2 py-1"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={submitRefund} disabled={refunding}>
                  {refunding ? "Refunding..." : "Confirm refund"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRefundOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
