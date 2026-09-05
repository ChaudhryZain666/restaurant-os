import { Schema, model, Types, type InferSchemaType } from "mongoose";

/**
 * One document per courier-provider webhook delivery, keyed on the provider's own event id — the
 * entire idempotency mechanism for delivery-status webhooks, byte-for-byte the same pattern as
 * PaymentWebhookEvent.ts: processing always starts by trying to insert here, and a duplicate-key
 * error means "already handled," so a provider's at-least-once webhook redelivery (Uber Direct's
 * own docs describe exactly this behavior) can never re-apply a status transition.
 */
const deliveryWebhookEventSchema = new Schema(
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

deliveryWebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export type DeliveryWebhookEventDoc = InferSchemaType<typeof deliveryWebhookEventSchema> & { _id: Types.ObjectId };
export const DeliveryWebhookEvent = model<DeliveryWebhookEventDoc>("DeliveryWebhookEvent", deliveryWebhookEventSchema);
