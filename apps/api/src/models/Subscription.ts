import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 24 — attaches to a polymorphic `{ownerType, ownerId}` pair, never directly to
 * Restaurant/Location and never hard-coded to Business either. Today only `ownerType: "business"`
 * is reachable through any real code path (no Agency collection exists yet — deferred to Phase
 * 25); `"agency"` is a reserved, forward-compatible slot. See
 * docs/multi-tenant-storefront-architecture.md's Phase 24 section for the full reasoning, and
 * packages/types/src/types/subscription.ts for the state/provider semantics.
 */
const subscriptionSchema = new Schema(
  {
    ownerType: { type: String, enum: ["business", "agency"], required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
    planId: { type: Schema.Types.ObjectId, ref: "Plan", required: true },
    status: {
      type: String,
      enum: ["trialing", "active", "past_due", "cancelling", "cancelled", "expired"],
      required: true,
      default: "trialing",
    },
    billingInterval: { type: String, enum: ["monthly", "yearly"], required: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    trialStart: { type: Date },
    trialEnd: { type: Date },
    cancelAt: { type: Date },
    cancelledAt: { type: Date },
    provider: { type: String, enum: ["mock", "internal"], required: true },
    providerCustomerId: { type: String },
    providerSubscriptionId: { type: String },
  },
  { timestamps: true, toJSON: idTransform }
);

// At most one LIVE subscription per owner — a real DB constraint, not just application discipline,
// mirroring DomainMapping.ts's "one active domain per location" pattern exactly. A cancelled/
// expired subscription is never deleted (financial history, matching Payment/Refund's convention)
// and is excluded from this index by the partial filter, so re-subscribing after cancellation
// creates a new document rather than resurrecting the old one.
subscriptionSchema.index(
  { ownerType: 1, ownerId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["trialing", "active", "past_due", "cancelling"] } } }
);
// Mirrors Payment.ts's {provider, providerRef} pattern: a real external subscription id must
// never map to two different Subscription documents. $type:"string" (not sparse:true) so two
// documents that both simply lack this field (e.g. "internal"/grandfathered subscriptions) never
// collide on a shared `null` — the same documented reasoning Payment.ts uses.
subscriptionSchema.index(
  { provider: 1, providerSubscriptionId: 1 },
  { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: "string" } } }
);

export type SubscriptionDoc = InferSchemaType<typeof subscriptionSchema>;
export const Subscription = model<SubscriptionDoc>("Subscription", subscriptionSchema);
