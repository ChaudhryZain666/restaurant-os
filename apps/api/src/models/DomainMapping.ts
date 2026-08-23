import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 22 — a verified custom domain resolving to exactly one Location (`Restaurant`). Every
 * render-affecting setting (currency, timezone, delivery, branding) is already Location-scoped
 * (see Restaurant.ts's `settings`), so a domain maps to a Location, never to a Business directly.
 * `businessId` is a denormalized cache (source of truth stays `Restaurant.businessId`) purely so
 * "list my business's domains" and business-scoped authorization don't need an extra join — the
 * same pattern MenuItemLocationOverride etc. already use for `businessId` alongside `locationId`.
 *
 * `verificationToken` is stored in PLAINTEXT, unlike this codebase's invite/reset-token convention
 * (secureToken.service.ts hashes those, since they're bearer credentials). A DNS TXT verification
 * value is different in kind: the owner must be shown the exact value repeatedly to paste into DNS,
 * and the platform must re-compare it against live DNS lookups an unbounded number of times — a
 * hash-only store would make that impossible. This is a deliberate departure, not an oversight.
 */
const domainMappingSchema = new Schema(
  {
    hostname: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    locationId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    status: {
      type: String,
      enum: ["pending_verification", "verified", "active"],
      default: "pending_verification",
      required: true,
    },
    verificationToken: { type: String, required: true },
    verificationCheckedAt: { type: Date },
    verifiedAt: { type: Date },
    activatedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

// At most one ACTIVE domain per location — a real DB constraint, not just application discipline,
// so a race between two "activate" requests (or activate-vs-delete) can never leave two live
// mappings for the same location. A pending/verified row for a *different* candidate hostname is
// still allowed to coexist with the currently-active one (the domain-replacement flow).
domainMappingSchema.index({ locationId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });
// businessId's own index (for the business-wide domain list) comes from the field-level
// `index: true` above — a separate schema.index({businessId:1}) call here would be a duplicate.

export type DomainMappingDoc = InferSchemaType<typeof domainMappingSchema>;
export const DomainMapping = model<DomainMappingDoc>("DomainMapping", domainMappingSchema);
