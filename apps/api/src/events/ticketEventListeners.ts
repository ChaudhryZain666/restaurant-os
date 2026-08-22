import { roomsForTicketEvent, ticketEventBus, type TicketEventPayload, type TicketEventType } from "./ticketEvents.js";
import { getIO } from "../realtime/socket.js";
import { notificationQueue } from "../queues/notification.queue.js";
import { logger } from "../common/logger.js";

const EVENT_TYPES: TicketEventType[] = [
  "ticket.created",
  "ticket.message.created",
  "ticket.status.changed",
  "ticket.assigned",
];

/**
 * Wires the ticket event bus to its current consumers, mirroring events/orderEventListeners.ts.
 * Call once at server startup.
 *
 * - Socket.IO: pushes a "ticket:event" message to the rooms roomsForTicketEvent selects — never
 *   computed inline here, so the internal-note room restriction lives in exactly one place.
 * - BullMQ: enqueues a job on the existing "notifications" queue, same seam-only pattern as
 *   order events (the worker only logs). Internal-note messages are never enqueued either —
 *   there is no legitimate external notification for content restaurant/customers can't see.
 */
export function registerTicketEventListeners(): void {
  for (const type of EVENT_TYPES) {
    ticketEventBus.on(type, (payload: TicketEventPayload) => {
      const io = getIO();
      if (io) {
        io.to(roomsForTicketEvent(payload)).emit("ticket:event", { type, ...payload });
      }

      if (!payload.isInternalMessage) {
        notificationQueue.add(type, payload).catch((err: unknown) => {
          logger.error("failed to enqueue ticket event notification job", {
            type,
            ticketId: payload.ticketId,
            error: (err as Error).message,
          });
        });
      }
    });
  }
}
