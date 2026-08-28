import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";

/**
 * Phase 32 — deletes expired public storefront-playground demo accounts (User.isDemoAccount:true,
 * demoExpiresAt in the past) and everything they created (their Order/Payment docs — matched by
 * customerId, not restaurantId, since a demo account could in principle place orders against more
 * than one restaurant). Idempotent, safe to re-run. This repo has no in-process cron (every other
 * one-off maintenance task here is a standalone script run by an external scheduler — see
 * backfillLocationCounts.ts) and no Mongo TTL index anywhere, so this mirrors that existing
 * convention rather than introducing a new persistence pattern.
 *
 * Usage: npm run --workspace apps/api cleanup:demo-data
 */
async function cleanup() {
  await connectDB();

  const expired = await User.find({ isDemoAccount: true, demoExpiresAt: { $lt: new Date() } }).select("_id");
  const userIds = expired.map((u) => u._id);

  if (userIds.length === 0) {
    console.log("[cleanup-demo-data] nothing expired");
    await mongoose.disconnect();
    return;
  }

  const [{ deletedCount: paymentsDeleted }, { deletedCount: ordersDeleted }, { deletedCount: usersDeleted }] =
    await Promise.all([
      Payment.deleteMany({ customerId: { $in: userIds } }),
      Order.deleteMany({ customerId: { $in: userIds }, isDemo: true }),
      User.deleteMany({ _id: { $in: userIds } }),
    ]);

  console.log(
    `[cleanup-demo-data] deleted users=${usersDeleted} orders=${ordersDeleted} payments=${paymentsDeleted}`
  );

  await mongoose.disconnect();
}

cleanup().catch((err) => {
  console.error("[cleanup-demo-data] failed", err);
  process.exit(1);
});
