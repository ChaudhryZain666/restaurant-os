import { Schema, model, Types, type InferSchemaType } from "mongoose";

/**
 * Phase 24 — the billing-provider counterpart to PaymentWebhookEvent.ts, deliberately a SEPARATE
 * collection even though the shape is identical: subscription billing and customer order payments
 * are different financial domains and must never share idempotency state. One document per
 * provider webhook delivery, keyed on the provider's own event id — this is the entire idempotency
 * mechanism. Processing a webhook always starts by trying to insert here; a duplicate-key error
 * means "already handled," and the handler acknowledges the request without re-applying any
 * transition. See apps/api/src/billing/MockBillingProvider.ts for the only adapter that runs today.
 */
const billingWebhookEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: { type: Schema.Types.Mixed },
    processedAt: { type: Date },
    processingError: { type: String },
  },
  { timestamps: true }
);

billingWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type BillingWebhookEventDoc = InferSchemaType<typeof billingWebhookEventSchema> & { _id: Types.ObjectId };
export const BillingWebhookEvent = model<BillingWebhookEventDoc>("BillingWebhookEvent", billingWebhookEventSchema);
