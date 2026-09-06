import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { redis } from "./config/redis.js";
import { queueConnection } from "./queues/connection.js";
import { startNotificationWorker, registerTrialReminderJob, registerPaymentReconciliationJob } from "./queues/notification.queue.js";
import { createSocketServer } from "./realtime/socket.js";
import { registerOrderEventListeners } from "./events/orderEventListeners.js";
import { registerTicketEventListeners } from "./events/ticketEventListeners.js";
import { logger } from "./common/logger.js";
import { createShutdownHandler } from "./shutdown.js";

/**
 * A narrow, last-resort safety net — NOT a general "ignore all crashes" handler (that would be
 * genuinely unsafe: Node's own docs are right that the correct response to an unrecognized
 * uncaughtException is to let the process exit, since its state afterward is unknown). This
 * exists because BullMQ's Redis-version compatibility check can reject asynchronously, later,
 * from inside its own internal reconnect/retry logic — outside of both the Queue/Worker 'error'
 * listeners already attached (queues/connection.ts, queues/notification.queue.ts) and the
 * fire-and-forget .catch() around job registration below. Confirmed by hitting it directly: those
 * weren't enough alone to stop the process from going down. Only this exact, well-understood
 * BullMQ error is treated as non-fatal; anything else still crashes the process exactly as before.
 */
function isKnownNonFatalQueueError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("Redis version needs to be greater or equal than");
}
process.on("uncaughtException", (err) => {
  if (isKnownNonFatalQueueError(err)) {
    logger.error("[queue] non-fatal background-job connection error, continuing without it", { error: err.message });
    return;
  }
  throw err;
});
process.on("unhandledRejection", (err) => {
  if (isKnownNonFatalQueueError(err)) {
    logger.error("[queue] non-fatal background-job connection error, continuing without it", { error: (err as Error).message });
    return;
  }
  throw err;
});

async function main() {
  await connectDB();
  const app = createApp();
  const httpServer = createServer(app);

  createSocketServer(httpServer);
  registerOrderEventListeners();
  registerTicketEventListeners();
  const notificationWorker = startNotificationWorker();

  // Deliberately NOT awaited before httpServer.listen() below. registerTrialReminderJob/
  // registerPaymentReconciliationJob add repeatable jobs to the queue — against an incompatible
  // Redis, BullMQ's underlying connection retries forever internally and this promise never
  // actually settles (neither resolves nor rejects), which previously meant the HTTP server never
  // started at all: a background-job registration hang was silently taking the entire API down
  // with it, not just disabling notifications. The API accepting requests must never depend on
  // this succeeding.
  Promise.all([registerTrialReminderJob(), registerPaymentReconciliationJob()]).catch((err) => {
    logger.error("[queue] could not register background jobs, continuing without them", { error: (err as Error).message });
  });

  httpServer.listen(env.PORT, () => {
    logger.info("server listening", { port: env.PORT });
  });

  // Phase 48 — hardened in three ways, all narrow: (1) a re-entrancy guard, since a platform can
  // send SIGTERM more than once (or SIGTERM followed by an operator's own SIGINT) and the old
  // version would run this whole sequence twice concurrently — a second httpServer.close()/
  // redis.quit()/etc. racing the first; (2) httpServer.close() is now actually awaited via its
  // callback instead of fire-and-forget, so "stop accepting new work" genuinely happens before
  // dependent connections are torn down, not just requested; (3) a hard deadline, since a hung
  // in-flight job (notificationWorker.close() waits for the current job to finish) previously had
  // no bound — a genuinely stuck job would keep the process alive forever instead of exiting so the
  // deployment platform's own supervisor can restart it. The sequencing itself lives in shutdown.ts
  // as a testable, dependency-injected factory — see shutdown.test.ts.
  const shutdown = createShutdownHandler({
    closeServer: () => new Promise<void>((resolvePromise) => httpServer.close(() => resolvePromise())),
    closeWorker: async () => {
      await notificationWorker.close();
    },
    closeRedis: async () => {
      await redis.quit();
    },
    closeQueueConnection: async () => {
      await queueConnection.quit();
    },
    logger,
    exit: (code) => process.exit(code),
  });

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
