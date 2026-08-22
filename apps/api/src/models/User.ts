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
  /** Set only for restaurant-scoped roles (owner/manager/staff/kitchen_staff). */
  restaurantId?: Types.ObjectId;
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
    phone: { type: String },
    refreshTokenVersion: { type: Number, default: 0 },
    addresses: { type: [addressSchema], default: [] },
    isActive: { type: Boolean, default: true },
    passwordResetTokenHash: { type: String, index: { sparse: true } },
    passwordResetExpiresAt: { type: Date },
    inviteTokenHash: { type: String, index: { sparse: true } },
    inviteExpiresAt: { type: Date },
    pendingEmail: { type: String, lowercase: true, trim: true },
    emailChangeTokenHash: { type: String, index: { sparse: true } },
    emailChangeExpiresAt: { type: Date },
    deletedAt: { type: Date },
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
