import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { redis } from "./config/redis.js";
import { queueConnection } from "./queues/connection.js";
import { startNotificationWorker, registerTrialReminderJob } from "./queues/notification.queue.js";
import { createSocketServer } from "./realtime/socket.js";
import { registerOrderEventListeners } from "./events/orderEventListeners.js";
import { registerTicketEventListeners } from "./events/ticketEventListeners.js";
import { logger } from "./common/logger.js";

async function main() {
  await connectDB();
  const app = createApp();
  const httpServer = createServer(app);

  createSocketServer(httpServer);
  registerOrderEventListeners();
  registerTicketEventListeners();
  const notificationWorker = startNotificationWorker();
  await registerTrialReminderJob();

  httpServer.listen(env.PORT, () => {
    logger.info("server listening", { port: env.PORT });
  });

  const shutdown = async (signal: string) => {
    logger.info("shutting down", { signal });
    httpServer.close();
    await notificationWorker.close();
    await redis.quit();
    await queueConnection.quit();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
