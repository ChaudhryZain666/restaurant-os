import { Queue, Worker, type Job } from "bullmq";
import type { SubscriptionOwnerType } from "@restaurant/types";
import { queueConnection } from "./connection.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { getEmailService } from "../email/index.js";
import {
  newOrderRestaurantEmail,
  orderConfirmationEmail,
  orderCancelledEmail,
  paymentReceiptEmail,
  paymentFailedEmail,
  refundConfirmationEmail,
  subscriptionPastDueEmail,
  subscriptionCancelledEmail,
  trialEndingEmail,
} from "../email/templates.js";
import { resolveOwnerIdentity } from "../services/ownerIdentity.service.js";
import { reconcileStalePayments } from "../services/payment.service.js";
import type { OrderEventPayload, OrderEventType } from "../events/orderEvents.js";
import type { TicketEventPayload, TicketEventType } from "../events/ticketEvents.js";

/**
 * One queue, four job families so far: the original demo ping, order lifecycle events, support
 * ticket events (enqueued by registerOrderEventListeners / registerTicketEventListeners), and
 * Phase 34's billing-lifecycle notifications (enqueued directly by billingHistory.service.ts and
 * the trial-reminder repeatable job — see registerTrialReminderJob below — rather than a parallel
 * event bus). Order events beyond "created"/"cancelled"/"payment_updated" still only log.
 */
export type BillingLifecycleKind = "trial_ending" | "past_due" | "cancelled";

export interface BillingLifecycleNotificationPayload {
  ownerType: SubscriptionOwnerType;
  ownerId: string;
  subscriptionId: string;
  kind: BillingLifecycleKind;
}

export type NotificationJobName =
  | "demo.ping"
  | OrderEventType
  | TicketEventType
  | "billing.lifecycle"
  | "billing.trial_reminder_tick"
  | "payment.reconciliation_tick";

export interface DemoPingPayload {
  message: string;
}

export type NotificationJobPayload =
  | DemoPingPayload
  | OrderEventPayload
  | TicketEventPayload
  | BillingLifecycleNotificationPayload
  | Record<string, never>;

export const notificationQueue = new Queue<NotificationJobPayload>("notifications", {
  connection: queueConnection,
});
// BullMQ's Queue wraps the connection and re-emits its own 'error' events independently of
// queueConnection's own listener (connection.ts) — needs its own guard for the same reason, or a
// connection-level failure (e.g. an incompatible Redis version) crashes the whole API process.
notificationQueue.on("error", (err: Error) => logger.error("[queue] notification queue error", { error: err.message }));

function formatOrderTotal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

type DispatchableOrderEvent = "order.created" | "order.cancelled" | "order.payment_updated";

function isOrderEvent(name: string): name is DispatchableOrderEvent {
  return name === "order.created" || name === "order.cancelled" || name === "order.payment_updated";
}

/**
 * Real email dispatch for the order events where a missed notification actually costs someone
 * something: a brand-new order (the restaurant needs to know NOW, not whenever someone next opens
 * the admin panel), a cancellation (the customer needs to know their order isn't coming), and —
 * Phase 34 — a payment outcome (receipt/failed/refund confirmation), branched on
 * OrderEventPayload.paymentOutcome (only ever set on "order.payment_updated" — see
 * events/orderEvents.ts). Looked up fresh from the DB rather than carried in the job payload —
 * keeps OrderEventPayload lean and always reflects the current restaurant/customer email, not
 * whatever it was at enqueue time. Failures here are logged, never thrown — a missed notification
 * email must never retry-loop or be mistaken for the order/payment pipeline itself failing.
 */
export async function dispatchOrderNotification(name: DispatchableOrderEvent, payload: OrderEventPayload): Promise<void> {
  const [order, restaurant, customer] = await Promise.all([
    Order.findById(payload.orderId),
    Restaurant.findById(payload.restaurantId).select("name email"),
    User.findById(payload.customerId).select("email"),
  ]);
  if (!order || !restaurant) return;

  const total = formatOrderTotal(order.total, order.currency);
  const trackingUrl = `${env.CLIENT_ORIGIN}/orders/${order.id}`;
  const emailService = getEmailService();

  if (name === "order.created") {
    if (restaurant.email) {
      await emailService.send(
        newOrderRestaurantEmail(restaurant.email, {
          restaurantName: restaurant.name,
          orderNumber: order.orderNumber,
          total,
          orderType: order.orderType,
          ordersUrl: `${env.ADMIN_ORIGIN}/orders`,
        })
      );
    }
    if (customer?.email) {
      await emailService.send(
        orderConfirmationEmail(customer.email, {
          restaurantName: restaurant.name,
          orderNumber: order.orderNumber,
          total,
          orderType: order.orderType,
          trackingUrl,
        })
      );
    }
  } else if (name === "order.cancelled") {
    if (customer?.email) {
      await emailService.send(
        orderCancelledEmail(customer.email, { restaurantName: restaurant.name, orderNumber: order.orderNumber, trackingUrl })
      );
    }
  } else if (name === "order.payment_updated" && customer?.email) {
    if (payload.paymentOutcome === "paid") {
      await emailService.send(
        paymentReceiptEmail(customer.email, { restaurantName: restaurant.name, orderNumber: order.orderNumber, total, trackingUrl })
      );
    } else if (payload.paymentOutcome === "failed") {
      await emailService.send(
        paymentFailedEmail(customer.email, { restaurantName: restaurant.name, orderNumber: order.orderNumber, trackingUrl })
      );
    } else if (payload.paymentOutcome === "refunded") {
      await emailService.send(
        refundConfirmationEmail(customer.email, {
          restaurantName: restaurant.name,
          orderNumber: order.orderNumber,
          amount: formatOrderTotal(payload.amount ?? order.total, order.currency),
          trackingUrl,
        })
      );
    }
    // "requires_action"/"authorized"/"cancelled" intentionally send nothing — none of those is a
    // moment worth emailing a customer about (an in-progress or abandoned payment attempt).
  }
}

const OWNER_BILLING_URL: Record<SubscriptionOwnerType, string> = {
  business: `${env.ADMIN_ORIGIN}/billing`,
  agency: `${env.ADMIN_ORIGIN}/agency/billing`,
};

/**
 * Trial-ending/past-due/cancelled emails — enqueued by billingHistory.service.ts (on the
 * payment_failed/cancelled/expired event types it already records) and by the trial-reminder
 * repeatable job (§2's `registerTrialReminderJob`). Looked up fresh from the DB, same convention as
 * dispatchOrderNotification. Failures logged, never thrown.
 */
export async function dispatchBillingLifecycleNotification(payload: BillingLifecycleNotificationPayload): Promise<void> {
  const [identity, subscription] = await Promise.all([
    resolveOwnerIdentity(payload.ownerType, payload.ownerId),
    Subscription.findById(payload.subscriptionId),
  ]);
  if (!identity?.email || !subscription) return;
  const plan = await Plan.findById(subscription.planId).select("name");
  const planName = plan?.name ?? "your plan";
  const billingUrl = OWNER_BILLING_URL[payload.ownerType];
  const emailService = getEmailService();

  if (payload.kind === "trial_ending" && subscription.trialEnd) {
    await emailService.send(
      trialEndingEmail(identity.email, { planName, trialEndsAt: subscription.trialEnd.toLocaleDateString(), billingUrl })
    );
  } else if (payload.kind === "past_due") {
    await emailService.send(subscriptionPastDueEmail(identity.email, { planName, billingUrl }));
  } else if (payload.kind === "cancelled") {
    await emailService.send(subscriptionCancelledEmail(identity.email, { planName, billingUrl }));
  }
}

const TRIAL_REMINDER_WINDOW_DAYS = 3;

/**
 * Runs on the "billing.trial_reminder_tick" repeatable job (registered once at startup by
 * registerTrialReminderJob — no in-process scheduler existed anywhere in this codebase before this;
 * every other periodic task is an externally-invoked standalone script). Finds every trialing
 * subscription whose trial ends within the next few days and hasn't been reminded yet, atomically
 * claims each one (findOneAndUpdate guarded by trialEndingReminderSentAt not yet set — the real
 * concurrency guard against two ticks/workers double-sending), then enqueues its own
 * "billing.lifecycle" job rather than sending email inline here.
 */
export async function runTrialEndingReminderSweep(): Promise<void> {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + TRIAL_REMINDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await Subscription.find({
    status: "trialing",
    trialEnd: { $gte: now, $lte: windowEnd },
    trialEndingReminderSentAt: { $exists: false },
  }).select("_id ownerType ownerId");

  for (const sub of candidates) {
    const claimed = await Subscription.findOneAndUpdate(
      { _id: sub._id, trialEndingReminderSentAt: { $exists: false } },
      { $set: { trialEndingReminderSentAt: now } }
    );
    if (!claimed) continue; // another tick/worker already claimed this one
    await notificationQueue
      .add("billing.lifecycle", {
        ownerType: sub.ownerType as SubscriptionOwnerType,
        ownerId: sub.ownerId.toString(),
        subscriptionId: sub.id as string,
        kind: "trial_ending",
      })
      .catch((err: unknown) => {
        logger.error("failed to enqueue trial-ending reminder", { subscriptionId: sub.id, error: (err as Error).message });
      });
  }
}

/** Registers the daily repeatable tick — BullMQ dedupes by the fixed jobId, so calling this on
 *  every server startup is idempotent, never creates a second repeating schedule. */
export async function registerTrialReminderJob(): Promise<void> {
  await notificationQueue.add(
    "billing.trial_reminder_tick",
    {},
    { repeat: { pattern: "0 9 * * *" }, jobId: "billing-trial-reminder-daily" }
  );
}

/** Phase 35 audit fix — registers the payment-reconciliation polling fallback (see
 *  payment.service.ts's reconcileStalePayments doc comment for why this exists at all) as a
 *  repeatable job, same idempotent-registration pattern as registerTrialReminderJob above. Runs
 *  every 10 minutes — frequent enough that a payment stuck on a missing/broken webhook gets caught
 *  and corrected within roughly RECONCILIATION_STALE_AFTER_MS (15 min) + one tick, not hours. */
export async function registerPaymentReconciliationJob(): Promise<void> {
  await notificationQueue.add(
    "payment.reconciliation_tick",
    {},
    { repeat: { pattern: "*/10 * * * *" }, jobId: "payment-reconciliation-every-10-min" }
  );
}

export function startNotificationWorker(): Worker<NotificationJobPayload> {
  const worker = new Worker<NotificationJobPayload>(
    "notifications",
    async (job: Job<NotificationJobPayload>) => {
      logger.info("processed notification job", { jobId: job.id, name: job.name, data: job.data });
      if (isOrderEvent(job.name)) {
        try {
          await dispatchOrderNotification(job.name, job.data as OrderEventPayload);
        } catch (err) {
          logger.error("order notification email failed", { jobId: job.id, name: job.name, error: (err as Error).message });
        }
      } else if (job.name === "billing.lifecycle") {
        try {
          await dispatchBillingLifecycleNotification(job.data as BillingLifecycleNotificationPayload);
        } catch (err) {
          logger.error("billing lifecycle notification email failed", { jobId: job.id, error: (err as Error).message });
        }
      } else if (job.name === "billing.trial_reminder_tick") {
        try {
          await runTrialEndingReminderSweep();
        } catch (err) {
          logger.error("trial-ending reminder sweep failed", { jobId: job.id, error: (err as Error).message });
        }
      } else if (job.name === "payment.reconciliation_tick") {
        try {
          await reconcileStalePayments();
        } catch (err) {
          logger.error("payment reconciliation sweep failed", { jobId: job.id, error: (err as Error).message });
        }
      }
    },
    { connection: queueConnection }
  );

  worker.on("failed", (job, err) => {
    logger.error("notification job failed", { jobId: job?.id, error: err.message });
  });
  // Same reasoning as notificationQueue's listener above — a Worker is a separate EventEmitter
  // from both queueConnection and the Queue, and needs its own guard against the same class of
  // connection-level failure crashing the process.
  worker.on("error", (err: Error) => logger.error("[queue] notification worker error", { error: err.message }));

  return worker;
}
