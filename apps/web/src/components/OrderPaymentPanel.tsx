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
 * hand off to whichever provider is actually configured server-side (Payment.provider, echoed back
 * on the created payment — never assumed client-side). For a real provider (anything but "mock"),
 * `clientSecret` is that provider's real hosted-checkout URL (see SafepayProvider.createIntent) and
 * the customer's browser is redirected there immediately — payment confirmation itself still comes
 * back through the existing webhook path (payment.service.ts's processProviderEvent), same as
 * before; this redirect only gets the customer TO the provider's page. Only when
 * `PAYMENT_PROVIDER=mock` (dev/test only — the /mock-complete route doesn't even exist otherwise,
 * see routes/payment.routes.ts) do the "Simulate..." buttons appear instead of a real redirect.
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
      if (payment.provider !== "mock" && clientSecret) {
        // Real provider: clientSecret IS the hosted-checkout URL — there's nothing left for this
        // panel to render, the customer is leaving the site until the provider redirects them back
        // to returnUrl/cancelUrl (payment.service.ts's createPaymentForOrder).
        window.location.href = clientSecret;
        return;
      }
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
          {state.payment.provider === "mock" ? (
            <div className="rounded-lg border border-dashed border-border bg-background p-3 text-sm text-muted">
              <p className="mb-2 font-medium text-foreground">Running against the mock payment provider (dev/test only).</p>
              <p className="mb-3">
                These buttons simulate what a real provider's hosted checkout would report back, through the same
                signed-webhook path a real integration uses.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => simulate("paid")} disabled={state.status === "processing"}>
                  {state.status === "processing" ? "Processing..." : "Simulate successful payment"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => simulate("failed")} disabled={state.status === "processing"}>
                  Simulate failed payment
                </Button>
              </div>
            </div>
          ) : (
            // Reachable only if a real provider's createIntent unexpectedly returned no checkout
            // URL — startPayment() redirects immediately for every other real-provider case, so
            // this state should never normally render.
            <Alert tone="danger" role="alert">
              This payment couldn't be started — the payment provider didn't return a checkout page. Please try again
              or contact the restaurant.
            </Alert>
          )}
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
