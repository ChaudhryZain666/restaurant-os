import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const categorySchema = new Schema(
  {
    // No standalone index: the compound index below already covers restaurantId-only queries
    // via its leading-field prefix.
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

categorySchema.index({ restaurantId: 1, isActive: 1, sortOrder: 1 });

export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export const Category = model<CategoryDoc>("Category", categorySchema);
