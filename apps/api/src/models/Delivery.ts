import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { DELIVERY_PROVIDER_NAMES, DELIVERY_STATUSES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, enum: DELIVERY_STATUSES, required: true },
    at: { type: Date, required: true },
    // Present only for a provider-driven transition (set from the webhook event that caused it) —
    // absent for a manual/staff action. Doubles as this entry's own idempotency breadcrumb: the
    // same webhook event can never appear twice in a row, since deliveryWebhook.service.ts's own
    // DeliveryWebhookEvent unique index already rejects the duplicate before this is ever written.
    providerEventId: { type: String },
    note: { type: String, maxlength: 300 },
  },
  { _id: false }
);

/**
 * One document per delivery DISPATCH attempt for an order — a different concern from
 * delivery.service.ts's eligibility/fee engine (untouched by this phase) and from
 * Order.deliveryAddress/deliveryDistanceKm/deliveryFee (the customer-facing snapshot, also
 * untouched). This is "did we actually ask a courier — ours or a third party's — to come get it,
 * and what happened." A separate collection, not a subdocument on Order, mirroring Payment.ts's
 * exact precedent: keeps a different lifecycle/write-frequency concern off the frequently-read
 * Order document, and lets a delivery be looked up/updated (by a webhook, by a retry job) without
 * loading or re-saving the whole order.
 *
 * `provider: "manual"` is a REAL, first-class value — a restaurant's own fleet/rider, dispatched
 * and tracked by staff directly (see docs/delivery-integrations.md) — not a placeholder for "no
 * provider configured." It requires no external account, no credentials, and is the default for
 * every restaurant that never connects a third-party courier API.
 */
const deliverySchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business" },
    // One delivery per order — enforced below by a unique index, not just application discipline,
    // so a duplicate creation attempt (double-click, retried request, retried queue job) can never
    // produce two Delivery documents for the same order regardless of which layer raced.
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    // Snapshotted (Order.orderNumber never changes after creation, but this avoids a join for
    // every delivery-list view — the same snapshot-over-live-reference principle as Order's own
    // orderItemSchema/tableName).
    orderNumber: { type: String, required: true },
    provider: { type: String, enum: DELIVERY_PROVIDER_NAMES, required: true },
    status: { type: String, enum: DELIVERY_STATUSES, default: "pending", required: true, index: true },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
    // What the courier/provider charges the RESTAURANT for this run — a different number from
    // Order.deliveryFee (what the CUSTOMER is charged), never conflated. Absent for "manual" (a
    // restaurant's own rider has no per-delivery provider fee in this system).
    fee: { type: Number, min: 0 },
    currency: { type: String },
    quoteId: { type: String },
    // The provider's own delivery id — absent for "manual". Indexed (sparse) so a webhook can find
    // the right Delivery by this id alone, without also needing the restaurant/order id.
    providerDeliveryId: { type: String },
    trackingUrl: { type: String },
    courierName: { type: String, maxlength: 200 },
    courierPhone: { type: String, maxlength: 40 },
    pickupEta: { type: Date },
    dropoffEta: { type: Date },
    cancelReason: { type: String, maxlength: 300 },
    // Set when a create/status-sync attempt genuinely fails (provider rejection, malformed
    // response) — distinct from `cancelReason` (a deliberate cancellation). See Part 5's "a failed
    // delivery request should have a clear internal state" — this is that state's explanation.
    failureReason: { type: String, maxlength: 500 },
    // The most recent provider error message, kept even after a later successful retry — for
    // diagnosing "why did this take three attempts" without needing a separate log lookup. Never a
    // raw stack trace, never a credential (see deliveryProviders/errors.ts).
    lastProviderError: { type: String, maxlength: 500 },
    // Caller-supplied, stable per order (see deliveryDispatch.service.ts) — the actual idempotency
    // mechanism for provider creation calls that support an idempotency key/header; also doubles as
    // this document's own natural dedupe key independent of the orderId unique index below.
    idempotencyKey: { type: String, required: true },
  },
  { timestamps: true, toJSON: idTransform }
);

deliverySchema.index({ orderId: 1 }, { unique: true });
deliverySchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
deliverySchema.index({ provider: 1, providerDeliveryId: 1 }, { sparse: true });
deliverySchema.index({ idempotencyKey: 1 }, { unique: true });

export type DeliveryDoc = InferSchemaType<typeof deliverySchema> & { _id: Types.ObjectId };
export const Delivery = model<DeliveryDoc>("Delivery", deliverySchema);
