import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Phase 25 — the explicit join model, never a singular `User.agencyId`. A user can hold one
 * membership row per agency (unique {agencyId, userId}) across multiple agencies, each with an
 * independent role — the reason this can't be a singular field the way `User.businessId` is.
 *
 * `businessIds` is optional, explicit per-business assignment — mirrors `User.locationIds` for
 * restaurant_staff exactly. `agency_owner`/`agency_admin` get IMPLICIT access to every business
 * under the agency (this field is ignored for them, checked in businessLocation.ts's
 * requireBusinessMatch); `agency_staff` gets access ONLY to businesses explicitly listed here.
 *
 * Carries its OWN invite token (separate from `User.inviteTokenHash`) since a person could
 * plausibly have a pending business-staff invite and an agency invite at the same time — conflating
 * the two fields would corrupt one or the other. See agencyMembership.controller.ts's acceptInvite.
 */
const agencyMembershipSchema = new Schema(
  {
    agencyId: { type: Schema.Types.ObjectId, ref: "Agency", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["agency_owner", "agency_admin", "agency_staff"], required: true },
    status: { type: String, enum: ["invited", "active", "revoked", "deactivated"], required: true, default: "invited" },
    businessIds: { type: [Schema.Types.ObjectId], ref: "Business", default: undefined },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
    inviteTokenHash: { type: String, index: { sparse: true } },
    inviteExpiresAt: { type: Date },
    acceptedAt: { type: Date },
  },
  { timestamps: true, toJSON: idTransform }
);

// One membership row per user per agency — re-inviting after a revoke updates this same row
// (status flips, never a duplicate insert) rather than creating a second one.
agencyMembershipSchema.index({ agencyId: 1, userId: 1 }, { unique: true });

export type AgencyMembershipDoc = InferSchemaType<typeof agencyMembershipSchema>;
export const AgencyMembership = model<AgencyMembershipDoc>("AgencyMembership", agencyMembershipSchema);
