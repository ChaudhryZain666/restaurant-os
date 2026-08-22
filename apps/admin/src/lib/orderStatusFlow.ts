import type { Order, OrderStatus } from "@restaurant/types";

// Mirrors the server's state machine (apps/api/src/services/orderStateMachine.ts) for the
// primary forward path only — the server is still the source of truth and will reject anything
// invalid regardless of what this map offers. Shared by OrdersManagementPage and KitchenPage so
// the two screens can never silently drift into offering different actions for the same status.
export function nextForwardStatus(order: Order): OrderStatus | null {
  switch (order.status) {
    case "pending":
      return "confirmed";
    case "confirmed":
      return "preparing";
    case "preparing":
      return "ready";
    case "ready":
      return order.orderType === "delivery" ? "out_for_delivery" : "completed";
    case "out_for_delivery":
      return "completed";
    default:
      return null;
  }
}

export function actionLabel(order: Order): string | null {
  switch (order.status) {
    case "pending":
      return "Accept";
    case "confirmed":
      return "Start preparing";
    case "preparing":
      return "Mark ready";
    case "ready":
      return order.orderType === "delivery" ? "Send for delivery" : "Complete";
    case "out_for_delivery":
      return "Complete";
    default:
      return null;
  }
}

export function isCancellable(status: OrderStatus): boolean {
  return status !== "completed" && status !== "cancelled";
}

/** An unpaid online order can't be accepted into the kitchen workflow — the server rejects it
 *  (order.controller.ts's updateOrderStatus); this is the client-side mirror so the UI never
 *  offers an action that would just fail. Cancelling out of "pending" is still always allowed. */
export function isAwaitingOnlinePayment(order: Order): boolean {
  return order.paymentMethod === "online" && order.paymentStatus !== "paid";
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "New",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "success",
  out_for_delivery: "success",
  completed: "success",
  cancelled: "danger",
};

/** Active-workload statuses, in workflow order — used by both the dashboard's active section and
 *  the KDS's columns. */
export const ACTIVE_STATUSES: OrderStatus[] = ["pending", "confirmed", "preparing", "ready", "out_for_delivery"];
