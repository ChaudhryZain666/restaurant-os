import { useEffect, useRef, useState } from "react";
import type { Order, Payment } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const PAID_BADGE_LABEL: Partial<Record<Payment["status"], string>> = {
  refunded: "Paid · Refunded",
  partially_refunded: "Paid · Partially refunded",
};

/** Order.paymentStatus stays "paid" forever once a payment succeeds — a refund is tracked
 *  separately on the Payment record (see docs/payment-provider-decision.md's "what's real"
 *  table), so this fetches the actual payment once to show "Paid · Refunded" instead of a bare
 *  "Paid" that would otherwise hide a refund from the customer. */
function PaidStatusBadge({ order }: { order: Order }) {
  const [label, setLabel] = useState("Paid");

  useEffect(() => {
    let cancelled = false;
    apiClient
      .request<{ payments: Payment[] }>(`/restaurants/${order.restaurantId}/orders/${order.id}/payments`)
      .then(({ payments }) => {
        if (cancelled) return;
        const latest = payments[0];
        if (latest && PAID_BADGE_LABEL[latest.status]) setLabel(PAID_BADGE_LABEL[latest.status]!);
      })
      .catch(() => {
        // Best-effort — a failed lookup just leaves the plain "Paid" label, not an error state.
      });
    return () => {
      cancelled = true;
    };
  }, [order.restaurantId, order.id]);

  return (
    <Card className="flex items-center justify-between gap-2">
      <span className="text-sm font-medium text-foreground">Payment</span>
      <Badge tone="success">{label}</Badge>
    </Card>
  );
}

type PanelState =
  | { status: "idle" }
  | { status: "creating" }
  | { status: "ready"; payment: Payment; clientSecret?: string }
  | { status: "processing"; payment: Payment }
  | { status: "error"; message: string };

const STATUS_LABEL: Record<Payment["status"], string> = {
  pending: "Waiting for payment",
  requires_action: "Action required",
  authorized: "Authorized",
  paid: "Paid",
  failed: "Payment failed",
  cancelled: "Cancelled",
  refunded: "Refunded",
  partially_refunded: "Partially refunded",
};

/**
 * Drives the entire online-payment lifecycle for one order: create/reuse a payment intent, then
 * — since no real provider is connected yet (see docs/payment-provider-decision.md) — let the
 * customer simulate the provider's hosted-checkout outcome via the mock-only /mock-complete
 * endpoint. Every button here is clearly labelled as a simulation; nothing pretends money moved.
 * A real provider adapter would replace the "Simulate..." buttons with that provider's actual
 * client-side SDK/redirect, without changing anything else about this panel's states.
 */
export function OrderPaymentPanel({ order, onOrderUpdated }: { order: Order; onOrderUpdated: () => Promise<void> }) {
  const [state, setState] = useState<PanelState>({ status: "idle" });
  // One idempotency key per checkout attempt — regenerated after a failure so a genuine retry
  // creates a fresh payment record rather than being folded into the failed one.
  const idempotencyKey = useRef(crypto.randomUUID());

  async function startPayment() {
    setState({ status: "creating" });
    try {
      const { payment, clientSecret } = await apiClient.request<{ payment: Payment; clientSecret?: string }>(
        `/restaurants/${order.restaurantId}/orders/${order.id}/payments`,
        { method: "POST", body: { idempotencyKey: idempotencyKey.current } }
      );
      setState({ status: "ready", payment, clientSecret });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }

  async function simulate(outcome: "paid" | "failed") {
    if (state.status !== "ready") return;
    const payment = state.payment;
    setState({ status: "processing", payment });
    try {
      await apiClient.request(
        `/restaurants/${order.restaurantId}/orders/${order.id}/payments/${payment.id}/mock-complete`,
        { method: "POST", body: { outcome } }
      );
      await onOrderUpdated();
      idempotencyKey.current = crypto.randomUUID();
      setState({ status: "idle" });
    } catch (err) {
      setState({ status: "error", message: (err as Error).message });
    }
  }

  if (order.paymentStatus === "paid") {
    return <PaidStatusBadge order={order} />;
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">Payment</span>
        <Badge tone="warning">Unpaid</Badge>
      </div>

      {state.status === "idle" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">This order is paid online. Complete payment to send it to the kitchen.</p>
          <Button onClick={startPayment} size="sm" className="self-start">
            Pay now
          </Button>
        </div>
      )}

      {state.status === "creating" && <p className="text-sm text-muted">Preparing payment...</p>}

      {(state.status === "ready" || state.status === "processing") && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Status</span>
            <Badge tone={state.payment.status === "failed" ? "danger" : "neutral"}>
              {STATUS_LABEL[state.payment.status]}
            </Badge>
          </div>
          <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-muted">
            <p className="mb-2 font-medium text-foreground">No real payment provider is connected yet.</p>
            <p className="mb-3">
              This platform's real provider decision (Safepay) is documented but not implemented — these buttons
              simulate what a provider's hosted checkout would report back, through the same signed-webhook path a
              real integration would use.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => simulate("paid")}
                disabled={state.status === "processing"}
              >
                {state.status === "processing" ? "Processing..." : "Simulate successful payment"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => simulate("failed")}
                disabled={state.status === "processing"}
              >
                Simulate failed payment
              </Button>
            </div>
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col gap-2">
          <Alert tone="danger" role="alert">
            {state.message}
          </Alert>
          <Button size="sm" variant="ghost" onClick={startPayment} className="self-start">
            Retry
          </Button>
        </div>
      )}
    </Card>
  );
}
