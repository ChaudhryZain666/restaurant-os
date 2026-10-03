import { Order } from "../models/Order.js";
import { Payment } from "../models/Payment.js";
import { User } from "../models/User.js";

/**
 * Phase 32 logic, moved here in Phase 87 so it can run on the existing BullMQ scheduler
 * (`demo.cleanup_tick`, hourly — queues/notification.queue.ts) as well as from the manual script
 * (scripts/cleanupDemoData.ts). Deletes expired public storefront-playground accounts
 * (User.isDemoAccount, demoExpiresAt in the past) and everything they created. Idempotent; only
 * ever touches demo accounts and their demo orders/payments.
 */
export async function cleanupExpiredDemoData(now = new Date()): Promise<{ users: number; orders: number; payments: number }> {
  const expired = await User.find({ isDemoAccount: true, demoExpiresAt: { $lt: now } }).select("_id");
  const userIds = expired.map((u) => u._id);
  if (userIds.length === 0) return { users: 0, orders: 0, payments: 0 };

  const [payments, orders, users] = await Promise.all([
    Payment.deleteMany({ customerId: { $in: userIds } }),
    Order.deleteMany({ customerId: { $in: userIds }, isDemo: true }),
    User.deleteMany({ _id: { $in: userIds }, isDemoAccount: true }),
  ]);
  return { users: users.deletedCount, orders: orders.deletedCount, payments: payments.deletedCount };
}
