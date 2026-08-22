import { Queue, Worker, type Job } from "bullmq";
import { queueConnection } from "./connection.js";
import { logger } from "../common/logger.js";
import type { OrderEventPayload, OrderEventType } from "../events/orderEvents.js";
import type { TicketEventPayload, TicketEventType } from "../events/ticketEvents.js";

/**
 * One queue, three job families so far: the original demo ping, order lifecycle events, and
 * support ticket events (enqueued by registerOrderEventListeners / registerTicketEventListeners
 * as the future seam for real dispatch — email, SMS, WhatsApp, push, analytics). The worker
 * still only logs; wiring an actual sender is future work, same as the queue's original
 * doc-comment always intended.
 */
export type NotificationJobName = "demo.ping" | OrderEventType | TicketEventType;

export interface DemoPingPayload {
  message: string;
}

export type NotificationJobPayload = DemoPingPayload | OrderEventPayload | TicketEventPayload;

export const notificationQueue = new Queue<NotificationJobPayload>("notifications", {
  connection: queueConnection,
});

export function startNotificationWorker(): Worker<NotificationJobPayload> {
  const worker = new Worker<NotificationJobPayload>(
    "notifications",
    async (job: Job<NotificationJobPayload>) => {
      logger.info("processed notification job", { jobId: job.id, name: job.name, data: job.data });
    },
    { connection: queueConnection }
  );

  worker.on("failed", (job, err) => {
    logger.error("notification job failed", { jobId: job?.id, error: err.message });
  });

  return worker;
}
