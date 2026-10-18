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
    // Agency-owned identity used by customer-facing white-label surfaces. Kept separate from
    // `name` so internal/legal agency naming can differ from the public brand.
    brandName: { type: String, trim: true, maxlength: 120 },
    brandPrimaryColor: { type: String, match: /^#[0-9a-fA-F]{6}$/ },
    whiteLabelEnabled: { type: Boolean, default: false },
    // Capabilities this agency chooses to offer. An empty list is the safe default.
    whiteLabelOfferings: { type: [String], enum: ["storefront_branding", "custom_domain", "hide_platform_branding", "support_branding", "email_branding", "branded_login"], default: [] },
    contactEmail: { type: String, required: true, lowercase: true, trim: true },
    status: { type: String, enum: ["pending", "active", "suspended"], default: "active" },
    // Maintained counter, incremented ATOMICALLY on business creation (see
    // agencyEntitlement.service.ts's reserveBusinessSlot) — the entitlement guard for
    // `max_businesses`. Never computed by counting Business documents on read, so the guard is a
    // single atomic findOneAndUpdate, not a check-then-insert race.
    businessCount: { type: Number, default: 0, min: 0 },
    // Phase 58, Section 12A — the agency's own domain (e.g. "mediabymiller.com"), proven by the same
    // DNS-TXT mechanism DomainMapping uses. Once verified (by one agency only) it (a) makes the
    // agency the owner of that namespace for its clients' storefront hostnames
    // (agencyDomainNamespace.service.ts) and (b) can carry a platform-authorized custom email
    // sender. It never routes traffic by itself. verificationToken is plaintext for the same reason
    // DomainMapping's is: it must be shown repeatedly and re-compared against live DNS.
    domain: { type: String, trim: true, lowercase: true, index: true },
    domainStatus: { type: String, enum: ["pending_verification", "verified"] },
    domainVerificationToken: { type: String },
    domainVerifiedAt: { type: Date },
    // White-label runtime — customer-facing support contact, shown only while `support_branding`
    // is active for a client (customerWhiteLabel.service.ts). Validated by updateAgencySchema.
    supportEmail: { type: String, trim: true, lowercase: true, maxlength: 254 },
    supportUrl: { type: String, trim: true, maxlength: 500 },
    // Optional custom "From" address for branded email (packages/types AgencyEmailSender). Used as
    // a sender ONLY in status "verified", which only a platform admin can set, and re-checked
    // against the agency's verified domain at send time (emailBranding.service.ts).
    emailSender: {
      type: new Schema(
        {
          address: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
          status: { type: String, enum: ["pending_domain", "pending_authorization", "verified", "failed"], required: true },
          requestedAt: { type: Date, required: true },
          verifiedAt: { type: Date },
          verifiedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
          failureReason: { type: String, maxlength: 300 },
        },
        { _id: false }
      ),
      default: undefined,
    },
  },
  { timestamps: true, toJSON: idTransform }
);

export type AgencyDoc = InferSchemaType<typeof agencySchema>;
export const Agency = model<AgencyDoc>("Agency", agencySchema);
