import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const menuItemSchema = new Schema(
  {
    // No standalone index on restaurantId: the compound index below already covers
    // restaurantId-only queries via its leading-field prefix — a separate single-field index
    // would be a pure duplicate (extra write/storage cost, zero query-plan benefit).
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String },
    isAvailable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    // Phase 19 — see Category.ts's clonedFromCategoryId for the full rationale. imageUrl is
    // copied as a literal shared URL on clone (not duplicated storage) — intentional.
    clonedFromMenuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem", select: false },
  },
  { timestamps: true, toJSON: idTransform }
);

menuItemSchema.index({ restaurantId: 1, categoryId: 1, sortOrder: 1 });

export type MenuItemDoc = InferSchemaType<typeof menuItemSchema>;
export const MenuItem = model<MenuItemDoc>("MenuItem", menuItemSchema);
