import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const loyaltyAccountSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    pointsBalance: { type: Number, default: 0, min: 0 },
    tier: { type: String, enum: ["bronze", "silver", "gold"], default: "bronze" },
  },
  { timestamps: true, toJSON: idTransform }
);

const loyaltyTransactionSchema = new Schema(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order" },
    type: { type: String, enum: ["earn", "redeem", "adjustment"], required: true },
    points: { type: Number, required: true },
    reason: { type: String, required: true },
  },
  { timestamps: true, toJSON: idTransform }
);

export type LoyaltyAccountDoc = InferSchemaType<typeof loyaltyAccountSchema>;
export const LoyaltyAccount = model("LoyaltyAccount", loyaltyAccountSchema);
export const LoyaltyTransaction = model("LoyaltyTransaction", loyaltyTransactionSchema);
