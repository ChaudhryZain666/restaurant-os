import type { OrderStatus } from "@restaurant/types";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "Order placed",
  confirmed: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** Text label always accompanies tone — status is never conveyed by color alone. */
export const ORDER_STATUS_TONE: Record<OrderStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  pending: "warning",
  confirmed: "info",
  preparing: "info",
  ready: "success",
  out_for_delivery: "success",
  completed: "success",
  cancelled: "danger",
};
