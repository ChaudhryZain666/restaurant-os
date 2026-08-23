import type { Types } from "mongoose";
import type { BillingHistoryEventType, SubscriptionOwnerType, SubscriptionProvider } from "@restaurant/types";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { logger } from "../common/logger.js";

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
  }
}
