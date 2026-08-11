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

const orderSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    orderNumber: { type: String, required: true },
    items: { type: [orderItemSchema], required: true, validate: (v: unknown[]) => v.length > 0 },
    status: { type: String, enum: ORDER_STATUSES, default: "pending", index: true },
    orderType: { type: String, enum: ["pickup", "delivery"], required: true },
    paymentStatus: { type: String, enum: ["unpaid", "paid"], default: "unpaid" },
    subtotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    deliveryFee: { type: Number, required: true, min: 0, default: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    loyaltyPointsEarned: { type: Number, default: 0 },
    loyaltyPointsRedeemed: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: String },
    customerNotes: { type: String, maxlength: 1000 },
  },
  { timestamps: true, toJSON: idTransform }
);

orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, orderNumber: 1 }, { unique: true });

export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };
export const Order = model<OrderDoc>("Order", orderSchema);
