import { Schema, model, Types, type InferSchemaType } from "mongoose";

/**
 * One document per provider webhook delivery, keyed on the provider's own event id — this is the
 * entire idempotency mechanism for webhooks. Processing a webhook always starts by trying to
 * insert here; a duplicate-key error means "already handled," and the handler acknowledges the
 * request without re-applying any state transition. Never store raw card data or other sensitive
 * payment-instrument details in `payload` — provider webhook events for this integration only
 * ever carry payment/refund status metadata (see apps/api/src/payments/MockPaymentProvider.ts).
 */
const webhookEventSchema = new Schema(
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

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type WebhookEventDoc = InferSchemaType<typeof webhookEventSchema> & { _id: Types.ObjectId };
export const PaymentWebhookEvent = model<WebhookEventDoc>("PaymentWebhookEvent", webhookEventSchema);
