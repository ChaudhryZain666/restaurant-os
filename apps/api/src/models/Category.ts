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
    // Phase 19 — set only when this Category was created via the Locations page's one-time
    // "clone from another location" convenience (see business.controller.ts's
    // createLocationForBusiness). A migration hook for a future shared-menu architecture to
    // detect "never touched since cloning" vs "diverged" — never read by any current code path,
    // never exposed via @restaurant/types or any API response (select: false).
    clonedFromCategoryId: { type: Schema.Types.ObjectId, ref: "Category", select: false },
  },
  { timestamps: true, toJSON: idTransform }
);

categorySchema.index({ restaurantId: 1, isActive: 1, sortOrder: 1 });

export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export const Category = model<CategoryDoc>("Category", categorySchema);
