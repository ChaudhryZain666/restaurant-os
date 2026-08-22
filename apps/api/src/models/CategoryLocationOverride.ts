import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 20 — a sparse per-location divergence from a business's canonical Category. A row exists
 * only when a location's effective value for an overridable field differs from the canonical
 * default; a location with zero overrides for a category has no row here at all. See
 * docs/multi-tenant-storefront-architecture.md's Phase 20 section for the full menu scope matrix
 * (name/description are canonical-only, never overridable — a different name is a different
 * category, not a variant).
 */
const categoryLocationOverrideSchema = new Schema(
  {
    // Redundant with the canonical Category's own businessId — stored here too for
    // defense-in-depth query scoping (e.g. a business-wide cache-invalidation fan-out can filter
    // by businessId alone), never trusted as sole proof of anything on its own.
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    isActive: { type: Boolean },
    sortOrderOverride: { type: Number },
  },
  { timestamps: true, toJSON: idTransform }
);

// One override row per category per location.
categoryLocationOverrideSchema.index({ locationId: 1, categoryId: 1 }, { unique: true });

export type CategoryLocationOverrideDoc = InferSchemaType<typeof categoryLocationOverrideSchema>;
export const CategoryLocationOverride = model<CategoryLocationOverrideDoc>(
  "CategoryLocationOverride",
  categoryLocationOverrideSchema
);
