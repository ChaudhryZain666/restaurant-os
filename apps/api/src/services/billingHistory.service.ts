import type { Types } from "mongoose";
import type { BillingHistoryEventType, SubscriptionOwnerType, SubscriptionProvider } from "@restaurant/types";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { logger } from "../common/logger.js";
import { notificationQueue, type BillingLifecycleKind } from "../queues/notification.queue.js";

// Only these event types are worth a platform email — deliberately excludes payment_succeeded/
// subscription_created/plan_changed/reactivated: Paddle, as Merchant of Record, already sends its
// own compliant receipt for a successful charge (docs/commercial-decisions.md §13), so a second
// "payment succeeded" platform email would be redundant. "expired" (a trial that never converted)
// reuses the "cancelled" email copy — both mean "you no longer have an active subscription."
const LIFECYCLE_EMAIL_KIND: Partial<Record<BillingHistoryEventType, BillingLifecycleKind>> = {
  payment_failed: "past_due",
  cancelled: "cancelled",
  expired: "cancelled",
};

interface RecordBillingHistoryEventInput {
  ownerType: SubscriptionOwnerType;
  ownerId: string | Types.ObjectId;
  subscriptionId: string | Types.ObjectId;
  type: BillingHistoryEventType;
  provider: SubscriptionProvider;
  amountCents?: number | null;
  currency?: string | null;
  providerReference?: string;
  receiptUrl?: string;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Phase 27 — writes one BillingHistoryEvent row, the data source for both "Billing History" and
 * "Invoices" (see packages/types/src/types/billingHistory.ts's doc comment). "Log and swallow,
 * never fail the real operation" — the same philosophy audit.service.ts's recordAuditEvent already
 * established: a billing-history write failing must never fail the subscription action or webhook
 * processing that triggered it.
 */
export async function recordBillingHistoryEvent(input: RecordBillingHistoryEventInput): Promise<void> {
  try {
    await BillingHistoryEvent.create({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      subscriptionId: input.subscriptionId,
      type: input.type,
      provider: input.provider,
      amountCents: input.amountCents,
      currency: input.currency,
      providerReference: input.providerReference,
      receiptUrl: input.receiptUrl,
      occurredAt: input.occurredAt ?? new Date(),
      metadata: input.metadata,
    });
  } catch (err) {
    logger.error("failed to record billing history event", { error: (err as Error).message, type: input.type });
    return;
  }

  // Phase 34 — a billing-history-worthy transition that's also lifecycle-email-worthy gets one
  // enqueued here, reusing this as the single choke point every such transition already passes
  // through rather than adding a parallel event bus. Enqueue failures are logged, never thrown —
  // matching this function's own "log and swallow, never fail the real operation" philosophy.
  const kind = LIFECYCLE_EMAIL_KIND[input.type];
  if (kind) {
    notificationQueue
      .add("billing.lifecycle", { ownerType: input.ownerType, ownerId: input.ownerId.toString(), subscriptionId: input.subscriptionId.toString(), kind })
      .catch((err: unknown) => {
        logger.error("failed to enqueue billing lifecycle notification", { error: (err as Error).message, type: input.type });
      });
  }
}
