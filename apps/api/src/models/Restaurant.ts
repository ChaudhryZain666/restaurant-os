import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

// Enum values are inlined here (not imported from @restaurant/types) because Mongoose's
// InferSchemaType has previously failed to narrow a schema's fields (falling back to `unknown`
// across the WHOLE schema, not just the enum field) when an `enum:` array came from another
// package — see apps/api/src/models/User.ts's history. Inline literal arrays are the
// known-working pattern used throughout this codebase's other models.
const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

const businessHoursDaySchema = new Schema(
  {
    day: { type: String, enum: WEEKDAYS, required: true },
    isClosed: { type: Boolean, default: false },
    open: { type: String },
    close: { type: String },
  },
  { _id: false }
);

const restaurantSettingsSchema = new Schema(
  {
    currency: { type: String, default: "USD" },
    timezone: { type: String, default: "UTC" },
    orderingEnabled: { type: Boolean, default: true },
    pickupEnabled: { type: Boolean, default: true },
    deliveryEnabled: { type: Boolean, default: false },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 1 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    businessHours: { type: [businessHoursDaySchema], default: [] },
    temporarilyPaused: { type: Boolean, default: false },
    pausedReason: { type: String, maxlength: 200 },
  },
  { _id: false }
);

const restaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String },
    logo: { type: String },
    coverImage: { type: String },
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    country: { type: String },
    postalCode: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    settings: { type: restaurantSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: idTransform }
);

export type RestaurantDoc = InferSchemaType<typeof restaurantSchema>;
export const Restaurant = model<RestaurantDoc>("Restaurant", restaurantSchema);
