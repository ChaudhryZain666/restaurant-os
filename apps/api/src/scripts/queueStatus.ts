/**
 * Phase 87 — read-only snapshot of the background-job system for deployment verification
 * (infrastructure/production/scripts/smoke-test.sh). Prints one JSON line:
 *
 *   { "redisVersion": "7.4.x", "workers": 1, "schedules": ["billing.trial_reminder_tick", "demo.cleanup_tick", …],
 *     "counts": { "waiting": 0, "active": 0, "delayed": 5, "failed": 0, "completed": 12 } }
 *
 * `workers` counts the BullMQ workers currently connected to the "notifications" queue, i.e. the
 * running API process's in-process worker. Writes nothing; connects only to Redis.
 *
 * Usage (production, inside the API container): node dist/scripts/queueStatus.js
 */
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../config/env.js";

async function main() {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("notifications", { connection });
  try {
    const client = await queue.client;
    const info = await client.info();
    const redisVersion = /redis_version:([^\r\n]+)/.exec(info)?.[1] ?? "unknown";
    const [workers, repeatables, counts] = await Promise.all([
      queue.getWorkers(),
      queue.getRepeatableJobs(),
      queue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
    ]);
    console.log(
      JSON.stringify({
        redisVersion,
        workers: workers.length,
        schedules: repeatables.map((r) => r.name).sort(),
        counts,
      })
    );
  } finally {
    await queue.close();
    await connection.quit();
  }
}

main().catch((err) => {
  // Never echo the connection string.
  console.error(`[queue-status] failed: ${(err as Error).message.replace(/rediss?:\/\/[^\s"]+/g, "redis://[redacted]")}`);
  process.exit(1);
});
