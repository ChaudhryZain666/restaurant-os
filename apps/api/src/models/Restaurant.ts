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
    dineInEnabled: { type: Boolean, default: false },
    // Payment methods offered to customers. There is deliberately no per-restaurant provider
    // credential field here — see docs/payment-provider-decision.md's "Restaurant payment
    // configuration" section: this platform uses one platform-owned payment-provider account
    // (selected via the server-only PAYMENT_PROVIDER env var), and onlinePaymentEnabled is purely
    // a per-restaurant opt-in/opt-out toggle on top of it, never a place secrets are stored.
    cashEnabled: { type: Boolean, default: true },
    onlinePaymentEnabled: { type: Boolean, default: false },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    taxRate: { type: Number, default: 0, min: 0, max: 1 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    // Straight-line (Haversine) radius from the restaurant's own latitude/longitude — see
    // docs/delivery-architecture.md. No default: undefined means "not configured," distinct from
    // 0 (which would mean "only deliver to this exact point").
    deliveryRadiusKm: { type: Number, min: 0.1, max: 100 },
    businessHours: { type: [businessHoursDaySchema], default: [] },
    temporarilyPaused: { type: Boolean, default: false },
    pausedReason: { type: String, maxlength: 200 },
    // Purely presentational (storefront primary color override) — see ThemeProvider in apps/web.
    // Validated server-side as a strict 6-digit hex pattern (packages/validation), so this can
    // never carry anything beyond a color.
    brandColor: { type: String, maxlength: 7 },
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
    // Entered manually, or resolved via the LocationIQ-backed geocoding autocomplete (Phase 10 —
    // see services/geocoding/). Kept as plain numbers, not GeoJSON, since nothing here does
    // proximity queries; that's a reason to migrate later, not a reason to build it now.
    latitude: { type: Number, min: -90, max: 90 },
    longitude: { type: Number, min: -180, max: 180 },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    settings: { type: restaurantSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, toJSON: idTransform }
);

export type RestaurantDoc = InferSchemaType<typeof restaurantSchema>;
export const Restaurant = model<RestaurantDoc>("Restaurant", restaurantSchema);
