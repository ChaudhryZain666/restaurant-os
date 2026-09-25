import { Schema, model, Types, type InferSchemaType } from "mongoose";

/**
 * The marketplace-order counterpart to BillingWebhookEvent.ts, deliberately a SEPARATE collection —
 * subscription billing and marketplace order delivery are different domains and must never share
 * idempotency state. Reuses the exact same atomic-claim pattern as
 * subscription.service.ts's claimWebhookEventForProcessing (see marketplaceWebhook.controller.ts),
 * not the weaker bare-insert+11000-catch pattern deliveryWebhook.controller.ts uses: a real
 * marketplace provider is at-least-once delivery, and a duplicate-processed order-ingestion event
 * would create a second real Order for the same external order — a materially worse outcome than a
 * duplicate delivery-status update, which is why the stronger pattern is used here.
 */
const marketplaceWebhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    processedAt: { type: Date },
    processingError: { type: String },
    // Set the moment an attempt begins actually processing this event (after the idempotency
    // claim), cleared on both success and failure — same "claimable vs. actively in-flight vs.
    // stuck" reasoning as BillingWebhookEvent.processingStartedAt's own doc comment.
    processingStartedAt: { type: Date },
  },
  { timestamps: true }
);

marketplaceWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
// Backs the stuck-event alert sweep (queues/notification.queue.ts's
// marketplace.stuck_event_check) — claimed-but-never-finished events past a short window need a
// human alerted before a provider's own accept/deny SLA (Uber Eats: 11.5 minutes) auto-cancels the
// order.
marketplaceWebhookEventSchema.index({ processingStartedAt: 1, processedAt: 1 });

export type MarketplaceWebhookEventDoc = InferSchemaType<typeof marketplaceWebhookEventSchema> & { _id: Types.ObjectId };
export const MarketplaceWebhookEvent = model<MarketplaceWebhookEventDoc>(
  "MarketplaceWebhookEvent",
  marketplaceWebhookEventSchema
);
