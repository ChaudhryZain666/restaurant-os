import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 28 — a named, priced reward catalog on top of the existing raw "spend N points as a
 * currency discount" mechanism (loyalty.service.ts's redeemPoints), which stays completely
 * unchanged. This model exists purely so customers have something to browse and choose ("Free
 * drink — 50 pts") instead of typing an arbitrary point quantity — selecting a reward on the
 * frontend still bottoms out in the same redeemPoints number (the reward's own pointCost), never a
 * new server-side redemption path. Restaurant-scoped, same tenant-isolation shape as Promotion.
 */
const loyaltyRewardSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 300 },
    pointCost: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

export type LoyaltyRewardDoc = InferSchemaType<typeof loyaltyRewardSchema>;
export const LoyaltyReward = model<LoyaltyRewardDoc>("LoyaltyReward", loyaltyRewardSchema);
