import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * qrToken is an opaque public identifier, stored RAW (not hashed) — unlike the password-reset/
 * invite tokens in secureToken.service.ts, this isn't a one-time secret proven once and
 * discarded; it must remain valid and re-displayable (re-print the QR, view it in the admin UI)
 * for the table's entire lifetime, so there's no "hash it and discard the raw value" step here.
 * Regenerating it (table.controller.ts's regenerateTableQr) is how an owner invalidates a
 * lost/compromised QR without deleting the table itself.
 */
const tableSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    capacity: { type: Number, min: 1, max: 100, default: 2 },
    section: { type: String, trim: true, maxlength: 50 },
    isActive: { type: Boolean, default: true },
    qrToken: { type: String, required: true },
  },
  { timestamps: true, toJSON: idTransform }
);

tableSchema.index({ restaurantId: 1, isActive: 1, name: 1 });
// Table lookup by QR scan is a point lookup on this alone — restaurantId is re-checked in the
// controller (never trust the token in isolation to also imply the right tenant), but the token
// itself must already be globally unique so two restaurants' tokens can never collide.
tableSchema.index({ qrToken: 1 }, { unique: true });

export type TableDoc = InferSchemaType<typeof tableSchema> & { _id: Types.ObjectId };
export const Table = model<TableDoc>("Table", tableSchema);
