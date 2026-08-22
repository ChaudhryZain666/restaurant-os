import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

const categorySchema = new Schema(
  {
    // No standalone index: the compound index below already covers restaurantId-only queries
    // via its leading-field prefix.
    // Legacy per-location scoping field. Stays required/populated for every document (never
    // dropped — see Phase 20's docs section), but becomes dead/forensic-only the moment a
    // document also carries businessId: no query reads both fields on the same document.
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    // Phase 20 — set once this Category has been migrated (or created) as a business-scoped
    // canonical document. Optional at the schema level, same treatment Restaurant.businessId got
    // in Phase 18, so a not-yet-migrated document is still valid. See
    // docs/multi-tenant-storefront-architecture.md's Phase 20 section.
    businessId: { type: Schema.Types.ObjectId, ref: "Business", index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Phase 19 — set only when this Category was created via the Locations page's one-time
    // "clone from another location" convenience (see business.controller.ts's
    // createLocationForBusiness). Deprecated as a product concept once Phase 20's canonical
    // sharing exists (superseded by menuBusinessMigration.service.ts's own provenance-based
    // matching, and by menuClone.service.ts's override-seeding redesign for post-migration
    // businesses) — kept, unread by product code, purely as the migration's own matching hook and
    // historical trail. Never exposed via @restaurant/types or any API response (select: false).
    clonedFromCategoryId: { type: Schema.Types.ObjectId, ref: "Category", select: false },
  },
  { timestamps: true, toJSON: idTransform }
);

categorySchema.index({ restaurantId: 1, isActive: 1, sortOrder: 1 });
categorySchema.index({ businessId: 1, isActive: 1, sortOrder: 1 });

export type CategoryDoc = InferSchemaType<typeof categorySchema>;
export const Category = model<CategoryDoc>("Category", categorySchema);
