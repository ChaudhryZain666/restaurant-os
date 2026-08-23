import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { BILLING_HISTORY_EVENT_TYPES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

export { BILLING_HISTORY_EVENT_TYPES };

/**
 * Phase 27 — the data source for both "Billing History" and "Invoices" (see
 * packages/types/src/types/billingHistory.ts's doc comment for the full reasoning). Polymorphic
 * like Subscription itself ({ownerType, ownerId}). Written by subscription.service.ts's *Core
 * functions (direct owner actions) AND by processBillingProviderEvent (webhook-driven payment
 * events) — never by a controller directly, so there is exactly one place that decides what counts
 * as a billing-history-worthy event.
 */
const billingHistoryEventSchema = new Schema(
  {
    ownerType: { type: String, enum: ["business", "agency"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription", required: true },
    type: { type: String, enum: BILLING_HISTORY_EVENT_TYPES, required: true },
    amountCents: { type: Number, min: 0 },
    currency: { type: String },
    provider: { type: String, enum: ["mock", "internal", "paddle"], required: true },
    providerReference: { type: String },
    receiptUrl: { type: String },
    occurredAt: { type: Date, required: true, default: () => new Date() },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: idTransform }
);

billingHistoryEventSchema.index({ ownerType: 1, ownerId: 1, occurredAt: -1 });

export type BillingHistoryEventDoc = InferSchemaType<typeof billingHistoryEventSchema> & { _id: Types.ObjectId };
export const BillingHistoryEvent = model<BillingHistoryEventDoc>("BillingHistoryEvent", billingHistoryEventSchema);
