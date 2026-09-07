import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const loyaltyAccountSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    pointsBalance: { type: Number, default: 0, min: 0 },
    tier: { type: String, enum: ["bronze", "silver", "gold"], default: "bronze" },
  },
  { timestamps: true, toJSON: idTransform }
);
loyaltyAccountSchema.index({ restaurantId: 1, customerId: 1 }, { unique: true });

const loyaltyTransactionSchema = new Schema(
  {
    // Phase 49 — was two independent single-field indexes (restaurantId, customerId), neither of
    // which actually matched any real query: getMyLoyaltyHistory filters {restaurantId, customerId}
    // and sorts createdAt (loyalty.controller.ts); getLoyaltySummary's two $group aggregations
    // filter {restaurantId, type}; its "recent transactions" fetch filters {restaurantId} alone,
    // sorted createdAt, limit 10. A single-field restaurantId index could narrow to the tenant but
    // left every sort/type-filter to an in-memory pass over that tenant's ENTIRE transaction
    // history — the single-field customerId index had no real caller at all (every query that
    // touches customerId also filters restaurantId first; grepped the full repo to confirm). See
    // the three compound indexes below, each tied to one of these three real query shapes.
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    type: { type: String, enum: ["earn", "redeem", "adjustment"], required: true },
    points: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { timestamps: true, toJSON: idTransform }
);
// getMyLoyaltyHistory (loyalty.controller.ts) — a customer's own transaction history at one
// restaurant, newest first.
loyaltyTransactionSchema.index({ restaurantId: 1, customerId: 1, createdAt: -1 });
// getLoyaltySummary's totalPointsIssued/totalPointsRedeemed aggregations — $match{restaurantId,
// type} then $group/$sum. Without this, only the (now-removed) single-field restaurantId index
// could narrow the scan, forcing every "earn" or "redeem" row in this restaurant's ENTIRE history
// to be read and filtered in application code on every dashboard load.
loyaltyTransactionSchema.index({ restaurantId: 1, type: 1 });
// getLoyaltySummary's "recent activity" fetch — restaurant-wide (not per-customer), newest 10. The
// index above can't serve this sort efficiently once customerId sits between restaurantId and
// createdAt in its key order, so this is a distinct, separately-justified index rather than reuse.
loyaltyTransactionSchema.index({ restaurantId: 1, createdAt: -1 });

export type LoyaltyAccountDoc = InferSchemaType<typeof loyaltyAccountSchema>;
export const LoyaltyAccount = model<LoyaltyAccountDoc>("LoyaltyAccount", loyaltyAccountSchema);
export const LoyaltyTransaction = model("LoyaltyTransaction", loyaltyTransactionSchema);
