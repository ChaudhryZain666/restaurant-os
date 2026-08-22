import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 20 — a sparse per-location divergence from a business's canonical MenuItem. See
 * CategoryLocationOverride.ts for the general shape/rationale. `priceOverride` is the
 * highest-stakes field here: `orderPricing.service.ts` is the ONLY code path that resolves this
 * into a customer-charged amount, always server-side, never trusting anything from a request body.
 */
const menuItemLocationOverrideSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    menuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
    isAvailable: { type: Boolean },
    priceOverride: { type: Number, min: 0 },
    sortOrderOverride: { type: Number },
  },
  { timestamps: true, toJSON: idTransform }
);

// One override row per menu item per location.
menuItemLocationOverrideSchema.index({ locationId: 1, menuItemId: 1 }, { unique: true });

export type MenuItemLocationOverrideDoc = InferSchemaType<typeof menuItemLocationOverrideSchema>;
export const MenuItemLocationOverride = model<MenuItemLocationOverrideDoc>(
  "MenuItemLocationOverride",
  menuItemLocationOverrideSchema
);
