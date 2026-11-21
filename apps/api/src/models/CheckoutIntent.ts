import { Schema, model, Types, type InferSchemaType } from "mongoose";

/**
 * Launch, 2026-11-21 — a pay-now purchase made on the PUBLIC checkout page (garnishtable.com/checkout)
 * by someone with no GarnishTable account yet: no login, no trial, charged at checkout.
 *
 * Lifecycle:
 *  - "open"    created when the page asks to start a checkout; holds only the plan and interval the
 *              buyer picked, plus the hash of a one-time set-up token given to that browser. Expires.
 *  - "paid"    set ONLY by the provider's verified webhook (subscription.created carrying this
 *              intent's id), never by the browser: records the provider subscription and customer,
 *              and the hash of a second set-up token that is emailed to the customer's address.
 *  - "claimed" the buyer set up their account (new or existing); the paid provider subscription is
 *              now an ordinary Subscription owned by that account (subscriptionId).
 *
 * Either token claims the purchase once. Until then, later provider events for the subscription are
 * acknowledged here instead of retried (there is no Subscription to apply them to); the claim reads
 * the subscription's current state from the provider, so nothing is lost.
 */
export const CHECKOUT_INTENT_STATUSES = ["open", "paid", "claimed"] as const;
export type CheckoutIntentStatus = (typeof CHECKOUT_INTENT_STATUSES)[number];

const checkoutIntentSchema = new Schema(
  {
    status: { type: String, enum: CHECKOUT_INTENT_STATUSES, required: true, default: "open" },
    provider: { type: String, required: true },
    planCode: { type: String, required: true },
    billingInterval: { type: String, enum: ["monthly", "yearly"], required: true },
    /** Hash of the token handed to the browser that started the checkout (never stored raw). */
    browserTokenHash: { type: String, required: true },
    /** Hash of the token emailed to the paying customer once the payment is verified. */
    emailTokenHash: { type: String },
    /** The address the customer gave the provider at checkout. */
    email: { type: String, lowercase: true, trim: true },
    providerCustomerId: { type: String },
    providerSubscriptionId: { type: String },
    /** The plan the provider actually sold (resolved from the subscription's price, not from the browser). */
    paidPlanCode: { type: String },
    paidBillingInterval: { type: String, enum: ["monthly", "yearly"] },
    paidEventId: { type: String },
    paidAt: { type: Date },
    /** Newest provider event seen while unclaimed — becomes the Subscription's event-ordering mark. */
    lastProviderEventAt: { type: Date },
    /** Set while an account set-up is linking the subscription; provider events then retry. */
    claimingAt: { type: Date },
    claimedAt: { type: Date },
    claimedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    /** Set while "open" only; MongoDB's TTL monitor removes abandoned checkouts. Unset once paid. */
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

checkoutIntentSchema.index({ browserTokenHash: 1 }, { unique: true });
checkoutIntentSchema.index({ emailTokenHash: 1 }, { unique: true, partialFilterExpression: { emailTokenHash: { $type: "string" } } });
checkoutIntentSchema.index(
  { provider: 1, providerSubscriptionId: 1 },
  { unique: true, partialFilterExpression: { providerSubscriptionId: { $type: "string" } } }
);
checkoutIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
checkoutIntentSchema.index({ status: 1, paidAt: 1 });

export type CheckoutIntentDoc = InferSchemaType<typeof checkoutIntentSchema> & { _id: Types.ObjectId };
export const CheckoutIntent = model<CheckoutIntentDoc>("CheckoutIntent", checkoutIntentSchema);
