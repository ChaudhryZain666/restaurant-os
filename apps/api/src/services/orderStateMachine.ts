import type { OrderStatus, OrderType } from "@restaurant/types";

/**
 * Explicit allowed transitions per status. `ready` branches differently depending on
 * orderType: delivery orders go out_for_delivery first, pickup orders complete directly.
 * Cancellation is allowed from any non-terminal state but is listed explicitly per state
 * rather than as a blanket exception, so the table stays the single source of truth.
 */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["out_for_delivery", "completed", "cancelled"],
  out_for_delivery: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function isValidStatusTransition(from: OrderStatus, to: OrderStatus, orderType: OrderType): boolean {
  if (!TRANSITIONS[from].includes(to)) return false;
  // ready -> out_for_delivery only makes sense for delivery orders; ready -> completed only for pickup.
  if (from === "ready" && to === "out_for_delivery" && orderType !== "delivery") return false;
  if (from === "ready" && to === "completed" && orderType !== "pickup") return false;
  return true;
}

export function isTerminalStatus(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
