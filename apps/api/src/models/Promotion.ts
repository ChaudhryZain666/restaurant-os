import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const promotionSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
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

// One restaurant can't define the same code twice; two restaurants can reuse the same code freely.
promotionSchema.index({ restaurantId: 1, code: 1 }, { unique: true });

export type PromotionDoc = InferSchemaType<typeof promotionSchema>;
export const Promotion = model<PromotionDoc>("Promotion", promotionSchema);
