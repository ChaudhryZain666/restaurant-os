import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const restaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
  },
  { timestamps: true, toJSON: idTransform }
);

export type RestaurantDoc = InferSchemaType<typeof restaurantSchema>;
export const Restaurant = model<RestaurantDoc>("Restaurant", restaurantSchema);
