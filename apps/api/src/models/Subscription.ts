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
    provider: { type: String, enum: ["mock", "internal", "paddle", "lemonsqueezy", "manual"], required: true },
    providerCustomerId: { type: String },
    providerSubscriptionId: { type: String },
    // provider:"manual" only — the terms a platform admin agreed (platformSubscription.service.ts).
    // amountCents is the agreed price per interval, never a payment; GarnishTable collects nothing.
    manualBilling: {
      type: new Schema(
        {
          kind: { type: String, enum: ["complimentary", "offline"], required: true },
          amountCents: { type: Number, min: 0, required: true },
          currency: { type: String, required: true },
          note: { type: String },
          createdByUserId: { type: Schema.Types.ObjectId, ref: "User" },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // A platform admin suspended this manual subscription — not live until unsuspended
    // (subscriptionResolution.service.ts's isSubscriptionLive).
    suspendedAt: { type: Date },
    suspendedReason: { type: String },
    // Phase 34, additive — dedup marker for the daily trial-ending-reminder sweep
    // (queues/notification.queue.ts's registerTrialReminderJob). Absence means "not sent yet" —
    // never overloaded onto BillingHistoryEvent, which exists for financial history, not
    // notification bookkeeping.
    trialEndingReminderSentAt: { type: Date },
    // Pre-launch — set when a no-card trial was held past its trialEnd because paid checkout was
    // unavailable (services/trialExtension.service.ts); `endedAt` when checkout opened (or the
    // extension was turned off) and the trial got its grace. originalTrialEnd is never overwritten.
    trialExtension: {
      type: new Schema({ extendedAt: Date, originalTrialEnd: Date, endedAt: Date }, { _id: false }),
      default: undefined,
    },
    // Phase 89 — `occurred_at` of the newest provider webhook whose period/plan details were
    // applied; an older event arriving late must not roll them back (subscription.service.ts's
    // applyProviderSubscriptionDetails).
    lastProviderEventAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

// toJSON is what owner-facing billing responses send: a manual subscription's internal admin note
// and the admin who created it stay platform-side (platformSubscription.service.ts's summary is the
// admin view). Set after construction — a custom transform in the constructor options breaks
// InferSchemaType for every field.
subscriptionSchema.set("toJSON", {
  ...idTransform,
  transform(doc: unknown, ret: Record<string, unknown>) {
    idTransform.transform(doc, ret);
    const manual = ret.manualBilling as Record<string, unknown> | undefined;
    if (manual) {
      delete manual.note;
      delete manual.createdByUserId;
    }
    return ret;
  },
});

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
