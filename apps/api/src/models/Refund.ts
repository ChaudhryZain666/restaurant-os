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
    // Set when the provider call's outcome is unknown (timeout, dropped connection, provider 5xx):
    // the refund stays "pending" with its amount reserved so it can't be issued twice, until a
    // same-key retry resumes it (idempotent providers only) or it is reconciled. See refundPayment.
    providerOutcomeUnknown: { type: Boolean },
    // Set once this refund's amount is reserved in Payment.totalRefunded (right after the atomic
    // reservation). Releasing a refund only gives back an amount this proves was reserved, so a crash
    // between the claim and the reservation can never release someone else's reservation.
    amountReserved: { type: Boolean },
    // A short lease held while a held refund is being re-issued, so two retries can never re-issue
    // it at the same time (reconcileRefund).
    reissueLeaseUntil: { type: Date },
    // The key sent to the provider (providerRefundIdempotencyKey) — also attached to the provider's
    // refund (Stripe metadata) so lookups and webhooks can find this refund.
    providerRefundKey: { type: String, index: true },
    // The provider's own status string (e.g. Stripe "requires_action"), for staff display.
    providerStatus: { type: String },
    // The last reconciliation lookup against the provider's records. A recent "not_found" is the
    // required evidence before staff can confirm a lookup-capable provider never made the refund.
    lastLookupAt: { type: Date },
    lastLookupResult: { type: String, enum: ["found", "not_found", "inconclusive"] },
    // How a held refund was finally settled — set once, never edited (the audit log has the same).
    resolution: {
      type: new Schema(
        {
          method: { type: String, enum: ["provider_response", "provider_lookup", "webhook", "manual"], required: true },
          outcome: { type: String, enum: ["refunded", "not_refunded"], required: true },
          providerRefundRef: { type: String },
          evidence: { type: String, maxlength: 1000 },
          resolvedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
          resolvedAt: { type: Date, required: true },
        },
        { _id: false }
      ),
      default: undefined,
    },
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
