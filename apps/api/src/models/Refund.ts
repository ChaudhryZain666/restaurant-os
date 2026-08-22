import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

export const REFUND_STATUSES = ["pending", "succeeded", "failed"] as const;

/**
 * A separate collection from Payment, not an embedded array, because a payment can accumulate
 * multiple partial refunds over time and each one needs its own status/provider-ref lifecycle
 * (a provider refund can itself fail or stay pending) — modelling that as a growing embedded
 * array on Payment would mean re-writing the whole array on every refund-status webhook, and
 * would make "sum of succeeded refunds for this payment" an in-application computation instead
 * of a straightforward indexed query.
 */
const refundSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    provider: { type: String, required: true },
    providerRefundRef: { type: String },
    amount: { type: Number, required: true, min: 0 },
    reason: { type: String, maxlength: 500 },
    status: { type: String, enum: REFUND_STATUSES, default: "pending", index: true },
    idempotencyKey: { type: String },
    initiatedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, toJSON: idTransform }
);

refundSchema.index({ restaurantId: 1, paymentId: 1, createdAt: -1 });
// Partial, not sparse — see the identical comment on Payment's equivalent indexes
// (models/Payment.ts): a sparse index still collides on an explicit `null`, only an
// explicit-type partial filter correctly excludes it.
refundSchema.index(
  { provider: 1, providerRefundRef: 1 },
  { unique: true, partialFilterExpression: { providerRefundRef: { $type: "string" } } }
);
refundSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export type RefundStatus = (typeof REFUND_STATUSES)[number];
export type RefundDoc = InferSchemaType<typeof refundSchema> & { _id: Types.ObjectId };
export const Refund = model<RefundDoc>("Refund", refundSchema);
