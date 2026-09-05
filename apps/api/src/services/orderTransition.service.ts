import type { HydratedDocument } from "mongoose";
import type { OrderStatus } from "@restaurant/types";
import { Order, type OrderDoc } from "../models/Order.js";
import { ApiError } from "../utils/ApiError.js";
import { isValidStatusTransition } from "./orderStateMachine.js";
import { reverseLoyaltyForOrderIfNeeded } from "./loyalty.service.js";
import { recordAuditEvent } from "./audit.service.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { logger } from "../common/logger.js";

export interface OrderStatusTransitionActor {
  userId: string;
  role: string;
}

export interface ApplyOrderStatusTransitionResult {
  order: HydratedDocument<OrderDoc>;
  previousStatus: OrderStatus;
}

/**
 * The single place an order's status is ever advanced/cancelled — extracted from
 * order.controller.ts's updateOrderStatus so delivery-provider-driven transitions
 * (deliveryDispatch.service.ts) reuse the exact same transition validation, payment guard,
 * statusHistory entry, and loyalty reversal instead of duplicating them.
 *
 * Callers own sending their own response and calling emitOrderEvent themselves afterward (see
 * order.controller.ts's updateOrderStatus) — this function never touches the HTTP response and
 * never emits, so a webhook handler that needs to ack the provider immediately isn't forced into
 * this function's timing.
 *
 * `actor` is omitted for automated transitions (a delivery webhook/provider status update) — there's
 * no real user to attribute an audit-log entry to, and AuditLog.actorUserId is a required real User
 * reference (no "system" sentinel). The Delivery model's own statusHistory is the audit trail for
 * those instead (see models/Delivery.ts).
 */
export async function applyOrderStatusTransition(params: {
  orderId: string;
  restaurantId: string;
  nextStatus: OrderStatus;
  actor?: OrderStatusTransitionActor;
}): Promise<ApplyOrderStatusTransitionResult> {
  const { orderId, restaurantId, nextStatus, actor } = params;

  const order = await Order.findOne({ _id: orderId, restaurantId });
  if (!order) throw ApiError.notFound("Order not found");

  if (!isValidStatusTransition(order.status, nextStatus, order.orderType)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.status}" to "${nextStatus}"`);
  }
  // An online order that hasn't actually been paid yet must not be accepted into the kitchen
  // workflow — cancelling out of "pending" is still allowed either way (nothing to protect there).
  if (order.paymentMethod === "online" && order.paymentStatus !== "paid" && nextStatus !== "cancelled") {
    throw ApiError.badRequest("This order's online payment has not completed yet — it cannot be accepted");
  }

  const previousStatus = order.status;
  order.status = nextStatus;
  order.statusHistory.push({ status: nextStatus, at: new Date() });
  await order.save();

  // Phase 17 product decision — cancelling a paid order does NOT auto-refund it. See
  // order.controller.ts's updateOrderStatus for the full rationale; unchanged by this extraction.
  if (nextStatus === "cancelled") {
    await reverseLoyaltyForOrderIfNeeded(order);
  }

  if (actor) {
    await recordAuditEvent({
      restaurantId,
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: nextStatus === "cancelled" ? "order.cancelled" : "order.status_changed",
      targetType: "order",
      targetId: order.id,
      metadata: { from: previousStatus, to: nextStatus },
    });
  }

  // Phase 40 — the moment a delivery order's food is ready is the moment to actually request a
  // courier (the eligibility/fee check happened at order-creation time; dispatching a real courier
  // any earlier would mean a rider waiting at a restaurant with nothing ready yet). Enqueued rather
  // than awaited inline: a courier-provider network call must never sit inside this request's
  // synchronous path or its failure risk turning a valid status change into a failed request — see
  // deliveryDispatch.service.ts's createDeliveryForOrder for why a provider-side failure there is
  // still never thrown back up to this job anyway (it lands the Delivery in a retryable "failed"
  // state instead).
  if (nextStatus === "ready" && order.orderType === "delivery") {
    notificationQueue.add("delivery.dispatch_create", { orderId: order.id, restaurantId }).catch((err: unknown) => {
      logger.error("failed to enqueue delivery dispatch job", { orderId: order.id, restaurantId, error: (err as Error).message });
    });
  }

  return { order, previousStatus };
}
