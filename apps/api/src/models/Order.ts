import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const selectedModifierSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "ModifierGroup", required: true },
    groupName: { type: String, required: true },
    optionId: { type: Schema.Types.ObjectId, required: true },
    optionName: { type: String, required: true },
    priceAdjustment: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// Order items snapshot name/price/modifiers at order time — deliberately duplicated from
// MenuItem/ModifierGroup rather than referenced live, so a later menu price change never
// alters the historical record of what a customer was actually charged.
const orderItemSchema = new Schema(
  {
    menuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    selectedModifiers: { type: [selectedModifierSchema], default: [] },
    lineTotal: { type: Number, required: true, min: 0 },
    // Customer-visible ("no onions") — distinct from Order.internalNote below, which is
    // staff-only. Never priced, never validated against menu data; free text passed through as-is.
    specialInstructions: { type: String, maxlength: 300 },
  },
  { _id: false }
);

// Snapshotted onto the order at creation time — the same snapshot-over-live-reference principle
// already used by orderItemSchema above and Table name-snapshotting. latitude/longitude are
// required here (unlike a saved Address, where they're optional) because createOrder always
// validates and stores them for a delivery order — see docs/delivery-architecture.md.
const deliveryAddressSchema = new Schema(
  {
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String },
    latitude: { type: Number, required: true, min: -90, max: 90 },
    longitude: { type: Number, required: true, min: -180, max: 180 },
    instructions: { type: String, maxlength: 300 },
  },
  { _id: false }
);

const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;

// One entry per status the order has actually passed through, in order — the source of data
// for the customer tracking timeline and the "relevant timestamps" the order detail view shows.
// Append-only, written exclusively by the server alongside each status transition.
const statusHistoryEntrySchema = new Schema(
  {
    status: { type: String, enum: ORDER_STATUSES, required: true },
    at: { type: Date, required: true },
  },
  { _id: false }
);

const orderSchema = new Schema(
  {
    // No standalone index on restaurantId: both compound indexes below lead with it, so a
    // separate single-field index would be a pure duplicate.
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderNumber: { type: String, required: true },
    items: { type: [orderItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    statusHistory: { type: [statusHistoryEntrySchema], default: [] },
    orderType: { type: String, enum: ["pickup", "delivery", "dine_in"], required: true },
    // POS phase — which surface created this order, orthogonal to orderType (see types/order.ts's
    // OrderChannel doc comment: a dine-in order can be self-ordered via QR just as easily as rung
    // up by staff for a walk-in table). Defaults to "online" so the entire pre-POS dataset is
    // correctly, implicitly online with zero migration required.
    channel: { type: String, enum: ["online", "pos"], default: "online" },
    // Live reference (for admin/KDS "show me this table's orders" queries) plus a snapshotted
    // name (for display without a join, and so a later table rename/deletion never changes how
    // a historical order reads — the same snapshot-over-live-reference reasoning as orderItemSchema
    // above). Both absent for non-dine-in orders. Resolved server-side from a QR token at
    // creation time — never trust a client-supplied tableId directly (order.controller.ts).
    tableId: { type: Schema.Types.ObjectId, ref: "Table" },
    tableName: { type: String, maxlength: 50 },
    // "cash" keeps using the pre-existing unpaid/paid flip below (staff marks it collected — see
    // updateOrderPaymentStatus) — that lifecycle is already correct and tested for cash-in-hand,
    // and refunds/provider-refs are meaningless for a transaction this app never touches. "online"
    // orders are instead backed by the Payment collection (apps/api/src/models/Payment.ts), which
    // is the only source of truth allowed to move this field to "paid" for that payment method.
    // "card" (added for POS, see docs/pos-architecture.md) is a THIRD staff-recorded method that
    // reuses the exact same manual paid/unpaid flip as "cash" — a restaurant's own physical card
    // reader isn't integrated with this platform, so a card payment collected at the register is,
    // from this system's point of view, identical to cash: staff confirms it happened, nothing is
    // charged or refunded through this app. updateOrderPaymentStatus already generalizes to "any
    // non-online method" and needed zero changes to support this.
    paymentMethod: { type: String, enum: ["cash", "card", "online"], default: "cash" },
    paymentStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    // Snapshotted from Restaurant.settings.currency at order creation time — the same
    // snapshot-over-live-reference principle as orderItemSchema's price fields above. Without
    // this, a cash order (which never gets a Payment document — see paymentMethod's comment
    // below) had NO durable record of which currency its numbers were even in, and a restaurant
    // changing its configured currency later would silently reinterpret every historical order's
    // stored numbers as the new currency.
    currency: { type: String, required: true, default: "USD" },
    subtotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    deliveryFee: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    promoCode: { type: String },
    promoDiscount: { type: Number, min: 0, default: 0 },
    loyaltyPointsEarned: { type: Number, default: 0 },
    loyaltyPointsRedeemed: { type: Number, default: 0 },
    // Set once this order's loyalty impact (earned points, redeemed points) has been reversed on
    // cancellation or full refund — see services/loyalty.service.ts's reverseLoyaltyForOrder. The
    // atomic guard against reversing the same order's points twice (e.g. a race between a customer
    // cancelling and staff issuing a refund around the same time).
    loyaltyReversed: { type: Boolean, default: false },
    total: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: deliveryAddressSchema },
    // The distance (km) createOrder actually validated against settings.deliveryRadiusKm at the
    // moment this order was placed — set only on delivery orders. A later change to the
    // restaurant's coordinates or radius setting never retroactively changes this record.
    deliveryDistanceKm: { type: Number, min: 0 },
    customerNotes: { type: String, maxlength: 1000 },
    // Staff-only ("regular, always double-checks the receipt") — never included in any
    // customer-facing response (see order.controller.ts's stripInternalFields). Set via a
    // dedicated PATCH, not part of order creation — customers can never write to this field.
    internalNote: { type: String, maxlength: 1000 },
    // Phase 32 — set server-side only (order.controller.ts's createOrder), true only when the
    // placing customer is a throwaway isDemoAccount:true User from the public storefront
    // playground. Excluded by default from listRestaurantOrders/analytics/platform aggregates so
    // public demo traffic never pollutes a real restaurant's live dashboards.
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true, toJSON: idTransform }
);

orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderNumber: 1 }, { unique: true });
// Dedicated to date-range aggregations (analytics time series) — the index above leads with
// status, so it can't give a single contiguous range scan on createdAt alone.
orderSchema.index({ restaurantId: 1, createdAt: -1 });
// Backs table-status derivation ("does this table have an active order") and the dashboard's
// per-table filter — sparse since most orders (pickup/delivery) never set tableId at all.
orderSchema.index({ restaurantId: 1, tableId: 1, status: 1 }, { sparse: true });
// Phase 12: customerId already has its own single-field index (declared above), which supports
// the equality filter on GET /orders/mine but not an efficient sort — without this compound
// index, paginating a customer's order history by createdAt would require an in-memory sort of
// every matching document before skip/limit could apply. This backs that query directly.
orderSchema.index({ customerId: 1, createdAt: -1 });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };
export const Order = model<OrderDoc>("Order", orderSchema);
