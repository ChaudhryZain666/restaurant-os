import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 59 — a purely informational commercial-agreement record: what THIS agency charges its OWN
 * client for its services. Entirely separate from Subscription (what the business/agency pays the
 * PLATFORM) — no provider, no webhook, no invoice, no payment is ever collected or processed through
 * this record. See agency.controller.ts's setClientCommercialTerms for the honesty boundary this
 * enforces at the API layer.
 *
 * `planLabel` is a free-text reference (optionally copied from the real owner-facing Plan catalog's
 * `name`/`code` by the frontend, purely so agencies aren't inventing inconsistent vocabulary) — it
 * does NOT affect the business's actual feature entitlements, which remain governed exclusively by
 * entitlementLimit.service.ts's existing inheritance chain (direct business subscription -> managing
 * agency's live subscription -> default). Changing/removing this record can never change what
 * features a business actually has access to.
 *
 * One record per business (at most) — a client has exactly one commercial relationship with its
 * managing agency at a time. Absence of a document IS the "not configured" state; there is
 * deliberately no separate "not_configured" enum value; the record only exists once an agency has
 * actually configured something.
 */
const clientCommercialTermsSchema = new Schema(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, unique: true },
    planLabel: { type: String, trim: true, maxlength: 80 },
    priceAmountCents: { type: Number, min: 0 },
    currency: { type: String, default: "USD" },
    billingCycle: { type: String, enum: ["monthly", "yearly"] },
    status: { type: String, enum: ["trial", "active", "cancelled"], default: "active" },
    trialEndsAt: { type: Date },
    startedAt: { type: Date },
    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true, toJSON: idTransform }
);

export type ClientCommercialTermsDoc = InferSchemaType<typeof clientCommercialTermsSchema>;
export const ClientCommercialTerms = model<ClientCommercialTermsDoc>("ClientCommercialTerms", clientCommercialTermsSchema);
