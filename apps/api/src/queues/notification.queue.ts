import { Queue, Worker, type Job } from "bullmq";
import { queueConnection } from "./connection.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { Order } from "../models/Order.js";
import { Restaurant } from "../models/Restaurant.js";
import { User } from "../models/User.js";
import { getEmailService } from "../email/index.js";
import { newOrderRestaurantEmail, orderConfirmationEmail, orderCancelledEmail } from "../email/templates.js";
import type { OrderEventPayload, OrderEventType } from "../events/orderEvents.js";
import type { TicketEventPayload, TicketEventType } from "../events/ticketEvents.js";

/**
 * One queue, three job families so far: the original demo ping, order lifecycle events, and
 * support ticket events (enqueued by registerOrderEventListeners / registerTicketEventListeners).
 * Order events beyond "created"/"cancelled" still only log — see dispatchOrderNotification below
 * for the two that now actually send email, closing the "restaurant/customer never learns about an
 * order unless their browser tab happens to be open" gap (Phase 29 audit finding P0-3).
 */
export type NotificationJobName = "demo.ping" | OrderEventType | TicketEventType;

export interface DemoPingPayload {
  message: string;
}

export type NotificationJobPayload = DemoPingPayload | OrderEventPayload | TicketEventPayload;

export const notificationQueue = new Queue<NotificationJobPayload>("notifications", {
  connection: queueConnection,
});

function formatOrderTotal(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function isOrderEvent(name: string): name is "order.created" | "order.cancelled" {
  return name === "order.created" || name === "order.cancelled";
}

/**
 * Real email dispatch for the two order events where a missed notification actually costs someone
 * something: a brand-new order (the restaurant needs to know NOW, not whenever someone next opens
 * the admin panel) and a cancellation (the customer needs to know their order isn't coming).
 * Looked up fresh from the DB rather than carried in the job payload — keeps OrderEventPayload
 * lean and always reflects the current restaurant/customer email, not whatever it was at enqueue
 * time. Failures here are logged, never thrown — a missed notification email must never retry-loop
 * or be mistaken for the order/payment pipeline itself failing.
 */
export async function dispatchOrderNotification(name: "order.created" | "order.cancelled", payload: OrderEventPayload): Promise<void> {
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
  } else if (customer?.email) {
    await emailService.send(
      orderCancelledEmail(customer.email, { restaurantName: restaurant.name, orderNumber: order.orderNumber, trackingUrl })
    );
  }
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
      }
    },
    { connection: queueConnection }
  );

  worker.on("failed", (job, err) => {
    logger.error("notification job failed", { jobId: job?.id, error: err.message });
  });

  return worker;
}
