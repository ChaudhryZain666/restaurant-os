import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

// Phase 18 — the commercial/brand entity that owns one or more Restaurant documents (each
// Restaurant is a physical location — see docs/multi-tenant-storefront-architecture.md's Phase 18
// section for why Restaurant itself was NOT renamed to Location). Deliberately carries no
// currency/timezone/address fields: those stay purely location-level on Restaurant, since nothing
// should force every location of a business onto one timezone or currency.
const businessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String },
    logo: { type: String },
    coverImage: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    // Purely presentational, purely a future pre-fill convenience when creating a new location
    // under this business — Restaurant.settings.brandColor stays the one field any storefront
    // render path actually reads. See the ADR for why this isn't resolved/merged anywhere yet.
    brandColor: { type: String, maxlength: 7 },
  },
  { timestamps: true, toJSON: idTransform }
);

export type BusinessDoc = InferSchemaType<typeof businessSchema>;
export const Business = model<BusinessDoc>("Business", businessSchema);
