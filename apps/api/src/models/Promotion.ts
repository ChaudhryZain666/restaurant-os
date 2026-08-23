import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const promotionSchema = new Schema(
  {
    // Phase 23 — a promotion is EITHER location-scoped (restaurantId set, businessId/locationIds
    // unset — the original, unchanged shape) OR business-scoped (businessId set, locationIds the
    // non-empty selected subset, restaurantId unset). restaurantId's requiredness mirrors the
    // exact Phase 21 Category/MenuItem pattern (required only for the doc shape that needs it).
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: "Restaurant",
      required: function (this: { businessId?: unknown }) {
        return !this.businessId;
      },
      index: true,
    },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", index: true },
    locationIds: { type: [Schema.Types.ObjectId], ref: "Restaurant" },
    // Stored uppercase so lookups are a plain equality match, not a case-insensitive query.
    code: { type: String, required: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    startDate: { type: Date },
    endDate: { type: Date },
    usageLimit: { type: Number, min: 1 },
    usageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, toJSON: idTransform }
);

// Two partial unique indexes (mirroring Payment.ts's established multi-partial-index pattern),
// each scoped to only the documents that actually carry the relevant field — so a location
// promotion and a business promotion never collide with each other under the wrong index, and two
// different businesses' business promotions can freely reuse the same code (matching how two
// different restaurants' location promotions already could).
promotionSchema.index(
  { restaurantId: 1, code: 1 },
  { unique: true, partialFilterExpression: { restaurantId: { $exists: true } } }
);
promotionSchema.index(
  { businessId: 1, code: 1 },
  { unique: true, partialFilterExpression: { businessId: { $exists: true } } }
);

export type PromotionDoc = InferSchemaType<typeof promotionSchema>;
export const Promotion = model<PromotionDoc>("Promotion", promotionSchema);
