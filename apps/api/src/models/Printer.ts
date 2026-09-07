import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { PRINTER_CONNECTION_TYPES, PRINTER_PURPOSES } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 57 — a standalone, location-scoped model (not folded into Restaurant.settings, unlike most
 * small feature toggles) because a restaurant can have several of these, each with its own identity
 * and connection lifecycle — the same reasoning Table.ts already established for a per-location
 * collection of independently-identified resources.
 *
 * `connectionConfig.bridgeUrl` is validated (packages/validation/src/printer.ts) to be loopback-only
 * (localhost/127.0.0.1) — the server never opens a network connection to it or to anything else a
 * restaurant configures here; only the browser (running on the restaurant's own machine) ever does.
 * See docs/pos-printer-architecture.md.
 */
const printerSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    name: { type: String, required: true, trim: true, maxlength: 50 },
    purpose: { type: String, enum: PRINTER_PURPOSES, required: true },
    connectionType: { type: String, enum: PRINTER_CONNECTION_TYPES, required: true },
    paperWidthMm: { type: Number, enum: [58, 80], default: 80 },
    isEnabled: { type: Boolean, default: true },
    // At most one enabled default per (restaurantId, purpose) — enforced in the controller (a
    // partial unique index can't express "unique among isDefault:true docs sharing a purpose"
    // portably across Mongo versions the way this codebase already avoids elsewhere).
    isDefault: { type: Boolean, default: false },
    connectionConfig: {
      bridgeUrl: { type: String, maxlength: 200 },
    },
  },
  { timestamps: true, toJSON: idTransform }
);

printerSchema.index({ restaurantId: 1, isEnabled: 1 });
printerSchema.index({ restaurantId: 1, purpose: 1, isDefault: 1 });

export type PrinterDoc = InferSchemaType<typeof printerSchema> & { _id: Types.ObjectId };
export const Printer = model<PrinterDoc>("Printer", printerSchema);
