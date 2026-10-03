import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { cleanupExpiredDemoData } from "../services/demoCleanup.service.js";

/**
 * Phase 32 — deletes expired public storefront-playground demo accounts (User.isDemoAccount:true,
 * demoExpiresAt in the past) and everything they created (their Order/Payment docs — matched by
 * customerId, not restaurantId, since a demo account could in principle place orders against more
 * than one restaurant). Idempotent, safe to re-run. This repo has no in-process cron (every other
 * one-off maintenance task here is a standalone script run by an external scheduler — see
 * backfillLocationCounts.ts) and no Mongo TTL index anywhere, so this mirrors that existing
 * convention rather than introducing a new persistence pattern.
 *
 * Phase 87 — production runs this hourly on the existing BullMQ scheduler (`demo.cleanup_tick`,
 * queues/notification.queue.ts); this script remains for a manual run.
 *
 * Usage: npm run --workspace apps/api cleanup:demo-data
 */
async function cleanup() {
  await connectDB();
  const { users, orders, payments } = await cleanupExpiredDemoData();
  console.log(
    users === 0
      ? "[cleanup-demo-data] nothing expired"
      : `[cleanup-demo-data] deleted users=${users} orders=${orders} payments=${payments}`
  );
  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error("[cleanup-demo-data] failed", err);
  process.exit(1);
});
