import { orderEventBus, type OrderEventPayload, type OrderEventType } from "./orderEvents.js";
import { getIO } from "../realtime/socket.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { logger } from "../common/logger.js";

const EVENT_TYPES: OrderEventType[] = [
  "order.created",
  "order.confirmed",
  "order.preparing",
  "order.ready",
  "order.out_for_delivery",
  "order.completed",
  "order.cancelled",
  "order.payment_updated",
];

/**
 * Wires the order event bus to its current consumers. Call once at server startup.
 *
 * - Socket.IO: pushes an "order:event" message to the customer's room (live tracking UI) and the
 *   restaurant's room (live dashboard), reusing the per-user/per-restaurant rooms already joined
 *   in realtime/socket.ts.
 * - BullMQ: enqueues a job on the existing "notifications" queue. The worker only logs today —
 *   this is the seam future dispatchers (email/SMS/WhatsApp/push) attach to, not a real
 *   notification being sent.
 */
export function registerOrderEventListeners(): void {
  for (const type of EVENT_TYPES) {
    orderEventBus.on(type, (payload: OrderEventPayload) => {
      const io = getIO();
      if (io) {
        io.to(`user:${payload.customerId}`)
          .to(`restaurant:${payload.restaurantId}`)
          .emit("order:event", { type, ...payload });
      }

      notificationQueue.add(type, payload).catch((err: unknown) => {
        logger.error("failed to enqueue order event notification job", {
          type,
          orderId: payload.orderId,
          error: (err as Error).message,
        });
      });
    });
  }
}
