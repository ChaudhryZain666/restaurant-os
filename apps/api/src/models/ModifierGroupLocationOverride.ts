import { Schema, model, Types } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

export interface ModifierOptionOverrideSubdoc {
  optionId: Types.ObjectId;
  isActive?: boolean;
  priceAdjustmentOverride?: number;
}

// Explicit interface rather than InferSchemaType — same subdocument-array class of issue
// documented in ModifierGroup.ts.
export interface ModifierGroupLocationOverrideDoc {
  businessId: Types.ObjectId;
  locationId: Types.ObjectId;
  modifierGroupId: Types.ObjectId;
  isActive?: boolean;
  optionOverrides: ModifierOptionOverrideSubdoc[];
}

const modifierOptionOverrideSchema = new Schema<ModifierOptionOverrideSubdoc>(
  {
    // References ModifierGroup.options[]._id (a subdocument id, not its own collection) — never
    // re-verified against a separate Modifier model, since none exists.
    optionId: { type: Schema.Types.ObjectId, required: true },
    isActive: { type: Boolean },
    priceAdjustmentOverride: { type: Number, min: 0 },
  },
  { _id: false }
);

/**
 * Phase 20 — a sparse per-location divergence from a business's canonical ModifierGroup. See
 * CategoryLocationOverride.ts for the general shape/rationale. `minSelect`/`maxSelect` are
 * deliberately NOT overridable (see the Phase 20 scope matrix in
 * docs/multi-tenant-storefront-architecture.md) — only group-level isActive and individual
 * options' isActive/priceAdjustment can diverge per location.
 */
const modifierGroupLocationOverrideSchema = new Schema<ModifierGroupLocationOverrideDoc>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    modifierGroupId: { type: Schema.Types.ObjectId, ref: "ModifierGroup", required: true },
    isActive: { type: Boolean },
    optionOverrides: { type: [modifierOptionOverrideSchema], default: [] },
  },
  { timestamps: true, toJSON: idTransform }
);

// One override row per modifier group per location.
modifierGroupLocationOverrideSchema.index({ locationId: 1, modifierGroupId: 1 }, { unique: true });

export const ModifierGroupLocationOverride = model<ModifierGroupLocationOverrideDoc>(
  "ModifierGroupLocationOverride",
  modifierGroupLocationOverrideSchema
);
