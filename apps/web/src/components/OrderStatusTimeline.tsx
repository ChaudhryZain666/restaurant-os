import type { Order, OrderStatus } from "@restaurant/types";

const PICKUP_STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "completed"];
const DELIVERY_STEPS: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "out_for_delivery", "completed"];

const STEP_LABELS: Record<OrderStatus, string> = {
  pending: "Order placed",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

/**
 * Reusable tracking timeline driven entirely by `order` — a caller that re-fetches or pushes a
 * fresher order object in (e.g. from a future Socket.IO "order:event" subscription) just
 * re-renders this with no other changes needed.
 */
export function OrderStatusTimeline({ order }: { order: Order }) {
  if (order.status === "cancelled") {
    return (
      <div className="flex items-center gap-2 rounded-md bg-danger/10 px-3 py-2 text-danger" role="status">
        <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden />
        <span className="text-sm font-medium">Order cancelled</span>
      </div>
    );
  }

  const steps = order.orderType === "delivery" ? DELIVERY_STEPS : PICKUP_STEPS;
  const historyByStatus = new Map(order.statusHistory.map((h) => [h.status, h.at]));
  const currentIndex = steps.indexOf(order.status);
  const progressPct = steps.length > 1 ? (currentIndex / (steps.length - 1)) * 100 : 0;

  return (
    <ol className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-0" aria-label="Order progress">
      {/* Connecting line (desktop): a static track plus an animated fill up to the current step. */}
      <div className="absolute left-0 right-0 top-3 hidden h-0.5 bg-border sm:block" aria-hidden>
        <div
          className="h-full bg-primary transition-[width] duration-slow ease-premium"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {steps.map((step, i) => {
        const done = i <= currentIndex;
        const isCurrent = i === currentIndex;
        const at = historyByStatus.get(step);
        return (
          <li key={step} className="relative flex flex-1 items-start gap-3 sm:flex-col sm:items-center sm:text-center">
            <span
              className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-normal ${
                done ? "bg-primary text-primary-foreground" : "bg-surface text-muted ring-1 ring-inset ring-border"
              }`}
              aria-hidden
            >
              {isCurrent && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/40" />}
              <span className="relative">{done && !isCurrent ? "✓" : i + 1}</span>
            </span>
            <div className="flex flex-col sm:mt-1.5">
              <span className={`text-sm font-medium ${done ? "text-foreground" : "text-muted"}`}>
                {STEP_LABELS[step]}
                {isCurrent && <span className="sr-only"> (current status)</span>}
              </span>
              {at && <span className="text-xs text-muted">{new Date(at).toLocaleString()}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
