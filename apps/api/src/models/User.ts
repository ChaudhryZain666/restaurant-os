import { Schema, model, Types } from "mongoose";
import { USER_ROLES, type UserRole } from "@restaurant/types";
import { idTransform } from "../utils/schemaOptions.js";

// Explicit interface rather than InferSchemaType: a subdocument array whose entries keep their
// own _id (needed so a customer can target one saved address for update/delete) produces the
// same InferSchemaType flattening problem documented on ModifierGroup.ts — worked around the
// same way, with a hand-written interface passed as the Schema<T> generic.
export interface AddressDoc {
  _id: Types.ObjectId;
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  // Optional — entered manually or resolved via geocoding autocomplete (see services/geocoding/).
  // Required only at the point a delivery order is actually placed (createOrderSchema's
  // deliveryAddress), not on a merely-saved address.
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
}

export interface UserDoc {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Set only for restaurant-scoped roles (owner/manager/staff/kitchen_staff). Pre-Phase-18 field,
   *  still the sole source of truth for every route guarded by requireTenantMatch — untouched by
   *  the Phase 18 Business/Location fields below so no existing authorization path changes. */
  restaurantId?: Types.ObjectId;
  /** Phase 18, additive — owner/manager/staff/kitchen_staff get this from their restaurant's
   *  businessId at invite/creation time. Not yet read by any pre-Phase-18 route; backs the new
   *  requireBusinessMatch/requireLocationAccess middleware only. */
  businessId?: Types.ObjectId;
  /** Phase 18, additive — which of the business's locations (Restaurant docs) this user can act
   *  on. Owner/manager get implicit access to every location under their businessId (checked via
   *  requireLocationAccess, not stored here); staff/kitchen_staff need explicit membership.
   *  Defaults to [restaurantId] at invite time (see staff.controller.ts's inviteStaff), same
   *  single-location behavior as today unless a manager later PATCHes it to add more. */
  locationIds: Types.ObjectId[];
  phone?: string;
  refreshTokenVersion: number;
  addresses: AddressDoc[];
  /** Staff accounts only — an owner deactivating a manager/staff/kitchen login sets this false. */
  isActive: boolean;
  /** SHA-256 hash of the current password-reset token, never the raw token — see auth.service.ts. */
  passwordResetTokenHash?: string;
  passwordResetExpiresAt?: Date;
  /** Set when a staff account is created via invite but hasn't set its own password yet. */
  inviteTokenHash?: string;
  inviteExpiresAt?: Date;
  /** Phase 28 — set true only when an agency provisions this owner's login directly (a real,
   *  system-generated temporary password) instead of the normal email-invite flow. Forces the
   *  account through the change-password screen (see middleware/auth.ts) before anything else is
   *  reachable; cleared by auth.controller.ts's changePassword the moment a new password is set.
   *  Never true for an invite-created or self-registered account. */
  mustChangePassword?: boolean;
  /** Self-service email change (Phase 12): the new address hasn't taken effect until its
   *  verification link is used — `email` above stays the CURRENT, real login identifier the whole
   *  time. Mirrors the passwordReset/inviteToken token-hash-only pattern above. */
  pendingEmail?: string;
  emailChangeTokenHash?: string;
  emailChangeExpiresAt?: Date;
  /** Set by self-service account deletion (customer role only — see auth.controller.ts's
   *  deleteMe). The account is anonymized, not removed: Order.customerId/AuditLog.actorUserId
   *  references must stay valid for order and audit-trail integrity. isActive is also set false
   *  so login() rejects it the same way a staff-deactivated account already does. */
  deletedAt?: Date;
  /** Phase 32 — set true only for a throwaway account created by POST /auth/demo-session (the
   *  public storefront playground). Gates isDemo on orders it places (order.controller.ts) and
   *  is excluded from every admin-facing order/customer list by default. Never true for a real
   *  registered or invited account. */
  isDemoAccount?: boolean;
  /** Phase 32 — set only alongside isDemoAccount; cleanupDemoData.ts deletes the account (and its
   *  demo orders) once this passes, so public playground traffic can't accumulate unbounded. */
  demoExpiresAt?: Date;
}

const addressSchema = new Schema<AddressDoc>({
  label: { type: String, maxlength: 50 },
  line1: { type: String, required: true, trim: true },
  line2: { type: String, trim: true },
  city: { type: String, required: true, trim: true },
  state: { type: String, trim: true },
  postalCode: { type: String, trim: true },
  country: { type: String, trim: true },
  latitude: { type: Number, min: -90, max: 90 },
  longitude: { type: Number, min: -180, max: 180 },
  isDefault: { type: Boolean, default: false },
});

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, default: "customer", index: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", index: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", index: true },
    locationIds: { type: [Schema.Types.ObjectId], ref: "Restaurant", default: [] },
    phone: { type: String },
    refreshTokenVersion: { type: Number, default: 0 },
    addresses: { type: [addressSchema], default: [] },
    isActive: { type: Boolean, default: true },
    passwordResetTokenHash: { type: String, index: { sparse: true } },
    passwordResetExpiresAt: { type: Date },
    inviteTokenHash: { type: String, index: { sparse: true } },
    inviteExpiresAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false },
    pendingEmail: { type: String, lowercase: true, trim: true },
    emailChangeTokenHash: { type: String, index: { sparse: true } },
    emailChangeExpiresAt: { type: Date },
    deletedAt: { type: Date },
    isDemoAccount: { type: Boolean, default: false },
    demoExpiresAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: {
      ...idTransform,
      transform(doc, ret) {
        idTransform.transform(doc, ret as Record<string, unknown>);
        const sensitive = ret as Record<string, unknown>;
        // Exposed as a plain boolean rather than the hash/expiry themselves — enough for the
        // Staff page to show "Invite pending", nothing an attacker could use as a token.
        sensitive.invitePending = Boolean(sensitive.inviteTokenHash);
        // Same reasoning as invitePending above — the account settings page needs to know a
        // change is pending, never the token itself.
        sensitive.emailChangePending = Boolean(sensitive.emailChangeTokenHash);
        delete sensitive.passwordHash;
        delete sensitive.passwordResetTokenHash;
        delete sensitive.passwordResetExpiresAt;
        delete sensitive.inviteTokenHash;
        delete sensitive.inviteExpiresAt;
        delete sensitive.pendingEmail;
        delete sensitive.emailChangeTokenHash;
        delete sensitive.emailChangeExpiresAt;
        const record = ret as unknown as { addresses?: Array<Record<string, unknown>> };
        record.addresses?.forEach((addr) => {
          if (addr._id) {
            addr.id = (addr._id as { toString(): string }).toString();
            delete addr._id;
          }
        });
        return ret;
      },
    },
  }
);

export const User = model<UserDoc>("User", userSchema);
