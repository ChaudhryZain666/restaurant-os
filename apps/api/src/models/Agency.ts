import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 25 — a new top-level entity, not a Business variant: an Agency organizationally manages
 * zero or more Businesses (via the additive, optional `Business.agencyId`) without ever replacing
 * `Business.ownerId`. Deliberately no `ownerId` field here, unlike Business — an Agency's ownership
 * IS its membership (an `agency_owner` AgencyMembership row), not a single ref; Business predates
 * membership modeling and keeps its legacy singular owner, Agency has no such baggage to preserve.
 * See docs/multi-tenant-storefront-architecture.md's Phase 25 section.
 */
const agencySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String },
    logo: { type: String },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    // Maintained counter, incremented ATOMICALLY on business creation (see
    // agencyEntitlement.service.ts's reserveBusinessSlot) — the entitlement guard for
    // `max_businesses`. Never computed by counting Business documents on read, so the guard is a
    // single atomic findOneAndUpdate, not a check-then-insert race.
    businessCount: { type: Number, default: 0, min: 0 },
    // Phase 58, Section 12A — the agency's candidate white-label domain (e.g. "mediabymiller.com").
    // Ownership-verification ONLY, reusing DomainMapping's exact DNS-TXT mechanism/field shapes —
    // this does NOT enable sending email from this domain or branding invitation emails (no such
    // infrastructure exists yet; see docs/agency-white-label-domain.md). verificationToken is
    // plaintext for the same reason DomainMapping's is: it must be shown to the agency repeatedly to
    // paste into DNS, and re-compared against live DNS lookups an unbounded number of times.
    domain: { type: String, trim: true, lowercase: true },
    domainStatus: { type: String, enum: ["pending_verification", "verified"] },
    domainVerificationToken: { type: String },
    domainVerifiedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

export type AgencyDoc = InferSchemaType<typeof agencySchema>;
export const Agency = model<AgencyDoc>("Agency", agencySchema);
