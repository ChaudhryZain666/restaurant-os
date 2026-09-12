import { useEffect, useRef, useState } from "react";
import type { Order } from "@restaurant/types";
import { Alert, Button, Spinner } from "@restaurant/ui";
import { formatCurrency } from "@restaurant/utils";
import { apiClient } from "../../lib/api";

type TerminalPaymentStatus = "pending" | "requires_action" | "authorized" | "paid" | "failed" | "cancelled";
interface TerminalPayment {
  id: string;
  status: TerminalPaymentStatus;
}

type Phase =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "waiting"; payment: TerminalPayment }
  | { kind: "processing"; payment: TerminalPayment }
  | { kind: "declined"; payment: TerminalPayment }
  | { kind: "cancelled"; payment: TerminalPayment }
  | { kind: "timeout"; payment: TerminalPayment }
  | { kind: "error"; message: string };

const POLL_INTERVAL_MS = 1500;
// A real terminal that hasn't resolved within this window gets treated as unresponsive rather than
// leaving staff staring at an indefinite spinner — matches the brief's own "Terminal did not
// respond. Retry." state. Purely a client-side polling concept: the server-side payment is left
// exactly as it was (still pending/requires_action/authorized) — a late resolution after this
// window elapses is still picked up correctly if staff retries and this component polls again.
const TIMEOUT_AFTER_MS = 45_000;

/**
 * Phase 74 — the terminal-ready card-payment flow, rendered by PaymentConfirmation.tsx ONLY when
 * this location has a real (today: mock, test/dev-only) card-terminal provider configured
 * (restaurant.posTerminalProviderConfigured && restaurant.settings.posTerminalEnabled). Every other
 * environment — which is every environment by default — keeps Phase 73's honest staff-attestation
 * card flow untouched.
 *
 * The POS never infers "paid" itself: every status shown here comes from a server response
 * (POST .../terminal-payment or a GET poll of it), which itself only reflects what
 * PaymentTerminalProvider.retrieve() actually reports — see docs/pos-architecture.md's Phase 74
 * section for the full state-machine writeup. Idempotency (Section 10) is enforced server-side by
 * Payment's own idempotencyKey unique index and its partial unique index on {orderId, status:
 * "paid"} — this component's job is just to never generate a fresh idempotency key except on a
 * genuine user-initiated new attempt (start/retry), exactly mirroring apps/web's
 * OrderPaymentPanel.tsx.
 */
export function TerminalCardPayment({
  order,
  restaurantId,
  onConfirmed,
  onCancelled,
}: {
  order: Order;
  restaurantId: string;
  onConfirmed: (order: Order) => void;
  onCancelled: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const idempotencyKey = useRef(crypto.randomUUID());
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollStartedAt = useRef(0);

  useEffect(
    () => () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    },
    []
  );

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function applyPayment(payment: TerminalPayment) {
    if (payment.status === "paid") {
      stopPolling();
      // The terminal payment reaching "paid" already set Order.paymentStatus server-side (the
      // same atomic transition path an online payment's webhook uses) — nothing else about the
      // order changed, so this avoids a redundant re-fetch just to render CompletedSale.
      onConfirmed({ ...order, paymentStatus: "paid" });
      return;
    }
    if (payment.status === "failed") {
      stopPolling();
      setPhase({ kind: "declined", payment });
      return;
    }
    if (payment.status === "cancelled") {
      stopPolling();
      setPhase({ kind: "cancelled", payment });
      return;
    }
    setPhase({ kind: payment.status === "authorized" ? "processing" : "waiting", payment });
  }

  function startPolling(paymentId: string) {
    pollStartedAt.current = Date.now();
    stopPolling();
    pollTimer.current = setInterval(async () => {
      if (Date.now() - pollStartedAt.current > TIMEOUT_AFTER_MS) {
        stopPolling();
        setPhase((prev) => (prev.kind === "waiting" || prev.kind === "processing" ? { kind: "timeout", payment: prev.payment } : prev));
        return;
      }
      try {
        const { payment } = await apiClient.request<{ payment: TerminalPayment }>(
          `/restaurants/${restaurantId}/pos/orders/${order.id}/terminal-payment/${paymentId}`
        );
        applyPayment(payment);
      } catch {
        // A single dropped poll isn't an error state — the next tick tries again. Only the
        // 45s-with-no-resolution window above surfaces anything to staff.
      }
    }, POLL_INTERVAL_MS);
  }

  async function start() {
    setPhase({ kind: "creating" });
    try {
      const { payment } = await apiClient.request<{ payment: TerminalPayment }>(
        `/restaurants/${restaurantId}/pos/orders/${order.id}/terminal-payment`,
        { method: "POST", body: { idempotencyKey: idempotencyKey.current } }
      );
      applyPayment(payment);
      if (payment.status !== "paid" && payment.status !== "failed" && payment.status !== "cancelled") {
        startPolling(payment.id);
      }
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  function retry() {
    // A genuinely new attempt — not the same one that just declined/cancelled/timed out — gets a
    // fresh idempotency key, exactly like apps/web's OrderPaymentPanel.tsx does after a failure.
    idempotencyKey.current = crypto.randomUUID();
    start();
  }

  /**
   * "Cancel sale" always ends with the ORDER itself cancelled — never just an abandoned pending
   * order with the cart state already cleared client-side (RegisterPage's resetSale, called via
   * onCancelled, clears the cart regardless). Mirrors PaymentConfirmation.tsx's own cancelSale()
   * for cash/staff-attested-card exactly, so "Cancel sale" means the same thing everywhere in the
   * POS regardless of which payment path was in progress.
   */
  async function cancelOrderAndReturn() {
    try {
      await apiClient.request(`/restaurants/${restaurantId}/orders/${order.id}/status`, {
        method: "PATCH",
        body: { status: "cancelled" },
      });
    } catch {
      // Best-effort — staff already chose to abandon this sale; a failed cancel-order call
      // shouldn't trap them on this screen (the order is picked up as a stray unpaid/pending
      // order via the existing Orders page either way — see Section 18's documented gap).
    }
    onCancelled();
  }

  async function cancelInFlight(paymentId: string) {
    stopPolling();
    try {
      await apiClient.request(`/restaurants/${restaurantId}/pos/orders/${order.id}/terminal-payment/${paymentId}/cancel`, {
        method: "POST",
      });
    } catch {
      // Best-effort notification to the (mock, today) terminal — the sale is being cancelled
      // either way; staff shouldn't be blocked on this specific call succeeding.
    }
    await cancelOrderAndReturn();
  }

  const amountLabel = formatCurrency(order.total, order.currency);

  if (phase.kind === "idle") {
    return (
      <div className="flex w-full max-w-xs flex-col gap-3 text-center">
        <p className="text-sm text-muted">Send {amountLabel} to the card terminal.</p>
        <Button size="lg" onClick={start}>
          Start card payment
        </Button>
        <button onClick={cancelOrderAndReturn} className="text-xs font-medium text-muted hover:text-foreground">
          Cancel sale
        </button>
      </div>
    );
  }

  if (phase.kind === "creating") {
    return (
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" label="Starting card payment" />
        <p className="text-sm text-muted">Starting card payment...</p>
      </div>
    );
  }

  if (phase.kind === "waiting" || phase.kind === "processing") {
    const waiting = phase.kind === "waiting";
    return (
      <div className="flex w-full max-w-xs flex-col items-center gap-3 text-center">
        <Spinner size="lg" label={waiting ? "Waiting for card" : "Processing payment"} />
        <div>
          <p className="font-medium text-foreground">{waiting ? "Waiting for card..." : "Processing payment..."}</p>
          <p className="text-sm text-muted">
            {waiting ? "Ask the customer to tap, insert, or swipe on the terminal." : "Do not remove the card yet."}
          </p>
        </div>
        <button
          onClick={() => cancelInFlight(phase.payment.id)}
          className="text-xs font-medium text-muted hover:text-foreground"
        >
          Cancel payment
        </button>
      </div>
    );
  }

  // declined | cancelled | timeout | error
  const title =
    phase.kind === "declined"
      ? "Payment declined"
      : phase.kind === "cancelled"
        ? "Payment cancelled"
        : phase.kind === "timeout"
          ? "Terminal did not respond"
          : "Something went wrong";
  const description =
    phase.kind === "error"
      ? phase.message
      : phase.kind === "timeout"
        ? "Check the terminal and try again."
        : "Try again, or cancel the sale and choose another payment method.";

  return (
    <div className="flex w-full max-w-xs flex-col gap-3 text-center">
      <Alert tone="danger" role="alert">
        <p className="font-medium">{title}</p>
        <p className="text-sm">{description}</p>
      </Alert>
      <Button size="lg" onClick={retry}>
        Retry card payment
      </Button>
      <button onClick={cancelOrderAndReturn} className="text-xs font-medium text-muted hover:text-foreground">
        Cancel sale
      </button>
    </div>
  );
}
