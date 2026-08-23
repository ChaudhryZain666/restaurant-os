import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const planPricingSchema = new Schema(
  {
    interval: { type: String, enum: ["monthly", "yearly"], required: true },
    // Phase 27 — now populated with PROPOSED (not commercially final — see
    // docs/commercial-decisions.md) pricing on the seeded catalog plans, but stays optional at the
    // schema level: the architecture must still support an unpriced/"contact us" plan without a
    // migration. See packages/types/src/types/plan.ts's doc comment for the full reasoning.
    amountCents: { type: Number, min: 0 },
    currency: { type: String },
    // Phase 27 — the provider's own identifier for this specific interval's price (e.g. a Paddle
    // "Price" object id). Absent for the mock provider and for any interval with no real provider
    // price configured yet. Never used to derive the actual charge amount server-side — the
    // provider's own webhook payload is what's trusted for that; this is purely so checkout can
    // tell the provider WHICH price to sell.
    providerPriceId: { type: String },
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
    // Phase 27, additive — customer-facing plan-comparison copy. Absent is valid (renders no
    // description), never required.
    description: { type: String },
    pricing: { type: [planPricingSchema], default: [] },
    entitlements: { type: [planEntitlementSchema], default: [] },
    // Phase 27 — the provider's own product identifier (one per Plan, e.g. a Paddle "Product" id,
    // distinct from each interval's own providerPriceId above). Absent for the mock provider.
    providerProductId: { type: String },
    // Phase 27 — per-plan trial-length override. Absent (the default for both seeded plans) falls
    // back to env.TRIAL_PERIOD_DAYS — see subscription.service.ts's resolveTrialDays. Exists so a
    // future plan can legitimately differ (e.g. a no-trial plan) without touching the global default
    // every other plan still relies on.
    trialDays: { type: Number, min: 0 },
    // Phase 27, additive — free-form catalog metadata (e.g. a marketing "most popular" flag) with no
    // dedicated field of its own yet. Never read for authorization/entitlement decisions.
    metadata: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

export type PlanDoc = InferSchemaType<typeof planSchema>;
export const Plan = model<PlanDoc>("Plan", planSchema);
