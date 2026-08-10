import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const menuItemSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, required: true },
    imageUrl: { type: String },
    isAvailable: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: idTransform }
);

menuItemSchema.index({ restaurantId: 1, category: 1, name: 1 });

export type MenuItemDoc = InferSchemaType<typeof menuItemSchema>;
export const MenuItem = model<MenuItemDoc>("MenuItem", menuItemSchema);
