import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

export const PAYMENT_STATUSES = [
  "pending",
  "requires_action",
  "authorized",
  "paid",
  "failed",
  "cancelled",
  "refunded",
  "partially_refunded",
] as const;

// Cash intentionally has no Payment documents — see Order.paymentMethod's doc comment in
// models/Order.ts for why. This collection exists only for payments that actually go through a
// provider, where a reference/status/refund lifecycle is meaningful.
export const PAYMENT_METHODS = ["online"] as const;

const paymentSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    method: { type: String, enum: PAYMENT_METHODS, default: "online" },
    // "mock" today — see apps/api/src/payments/ and docs/payment-provider-decision.md for the
    // real provider selected for this platform's market and why it isn't wired up yet.
    provider: { type: String, required: true },
    providerRef: { type: String },
    // Set only when this payment used a restaurant's own BYOC-connected account (see
    // payments/restaurantProvider.ts) rather than the platform's pooled default — refundPayment
    // needs this to rebuild the SAME credentials the original charge used, not whatever the
    // pooled default currently resolves to. Never set for a pooled-account payment.
    restaurantPaymentAccountId: { type: Schema.Types.ObjectId, ref: "RestaurantPaymentAccount" },
    currency: { type: String, required: true },
    // Snapshotted from Order.total by payment.service.ts at creation time — the server-computed
    // total is the ONLY source for this value; it is never accepted from a request body.
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: PAYMENT_STATUSES, default: "pending", index: true },
    failureCode: { type: String },
    failureMessage: { type: String },
    // Denormalized running sum of succeeded refunds against this payment (Phase 16) — the
    // guard refundPayment reserves against atomically at write time. NOT just derivable by
    // summing the Refund collection on every request: that read-then-decide is exactly the race
    // that let two concurrent refund requests both pass a remaining-balance check before either
    // had recorded its result (see services/payment.service.ts's refundPayment doc comment).
    totalRefunded: { type: Number, default: 0, min: 0 },
    // Supplied by the client once per checkout attempt (see the unique index below) — lets a
    // double-clicked "Pay" button or a retried request reuse the same payment instead of
    // creating a second one.
    idempotencyKey: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true, toJSON: idTransform }
);

paymentSchema.index({ restaurantId: 1, orderId: 1, createdAt: -1 });
// One PAID payment per order: a partial unique index, so multiple pending/failed attempts on the
// same order stay allowed (retries), but a second payment can never independently reach "paid"
// once one already has. The DB-level backstop for "an order must never have two successful
// payments," enforced even under a race between two concurrent webhook deliveries.
paymentSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { status: "paid" } });
// Prevents two Payment documents from ever representing the same provider transaction — protects
// against a webhook retry or a duplicate client request creating a second record for one real
// payment. A partial index filtered on the field actually being a string, NOT `sparse: true`:
// sparse only excludes documents where the field is entirely MISSING, but Mongoose can still
// persist an explicit `null` for an unset field, and a sparse unique index treats every such
// `null` as the same indexed value — a second document with no providerRef/idempotencyKey yet
// would collide with the first instead of being excluded.
paymentSchema.index(
  { provider: 1, providerRef: 1 },
  { unique: true, partialFilterExpression: { providerRef: { $type: "string" } } }
);
paymentSchema.index(
  { restaurantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentDoc = InferSchemaType<typeof paymentSchema> & { _id: Types.ObjectId };
export const Payment = model<PaymentDoc>("Payment", paymentSchema);
