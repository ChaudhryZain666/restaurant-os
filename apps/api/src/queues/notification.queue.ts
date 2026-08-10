import { Queue, Worker, type Job } from "bullmq";
import { queueConnection } from "./connection.js";
import { logger } from "../common/logger.js";

/**
 * Foundation only: one queue proving BullMQ works end-to-end. Real job types
 * (SendEmail, SendSMS, SendWhatsApp, ProcessOrderEvent, UpdateAnalytics, ...)
 * get added here as each feature is actually built — not before.
 */
export type NotificationJobName = "demo.ping";

export interface DemoPingPayload {
  message: string;
}

export const notificationQueue = new Queue<DemoPingPayload>("notifications", {
  connection: queueConnection,
});

export function startNotificationWorker(): Worker<DemoPingPayload> {
  const worker = new Worker<DemoPingPayload>(
    "notifications",
    async (job: Job<DemoPingPayload>) => {
      logger.info("processed notification job", { jobId: job.id, name: job.name, data: job.data });
    },
    { connection: queueConnection }
  );

  worker.on("failed", (job, err) => {
    logger.error("notification job failed", { jobId: job?.id, error: err.message });
  });

  return worker;
}
