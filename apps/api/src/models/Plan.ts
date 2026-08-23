import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const planPricingSchema = new Schema(
  {
    interval: { type: String, enum: ["monthly", "yearly"], required: true },
    // Deliberately optional — no real commercial pricing has been decided yet. See
    // packages/types/src/types/plan.ts's doc comment for why this is left absent rather than
    // populated with an invented number.
    amountCents: { type: Number, min: 0 },
    currency: { type: String },
  },
  { _id: false }
);

const planEntitlementSchema = new Schema(
  {
    key: { type: String, required: true },
    value: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false }
);

/**
 * Phase 24 — a small, mostly-static commercial catalog. `type` is the tier (OWNER/AGENCY),
 * independent of `Subscription.ownerType` (the structural pointer to who holds a subscription) —
 * see Subscription.ts's header comment for the full reasoning.
 */
const planSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["OWNER", "AGENCY"], required: true },
    pricing: { type: [planPricingSchema], default: [] },
    entitlements: { type: [planEntitlementSchema], default: [] },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

export type PlanDoc = InferSchemaType<typeof planSchema>;
export const Plan = model<PlanDoc>("Plan", planSchema);
