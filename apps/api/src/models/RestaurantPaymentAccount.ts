import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Restaurant-owned payment accounts (BYOC — "bring your own credentials"). Lets a restaurant
 * connect its OWN Stripe or Safepay account instead of using the platform's pooled default (see
 * payments/eligibility.ts) — money then settles directly into that restaurant's own account. A
 * separate collection, not a Restaurant subdocument, mirroring DomainMapping.ts's exact precedent:
 * keeps encrypted secrets off the frequently-fetched Restaurant document and gives this its own
 * verification lifecycle. Scoped per LOCATION (`restaurantId`), not per business — a multi-location
 * business can connect a different account per location if it wants to, same granularity
 * DomainMapping already uses for custom domains.
 *
 * `encryptedCredentials` is an AES-256-GCM envelope (see utils/credentialEncryption.ts) — never
 * queried or indexed on, only decrypted at the exact point of use (restaurantProvider.ts). Never
 * present in any API response: the toJSON transform below strips it unconditionally, the same
 * standard User.ts already holds passwordHash to.
 *
 * `status` has no "verified" stage the way DomainMapping does — DNS propagation creates a real time
 * gap between "provably yours" and "ready to cut over" that has no equivalent here, so connecting
 * an account synchronously verifies and activates it in one step (see restaurantProvider.ts).
 * `disconnected` is a soft transition, never a delete — refundPayment needs a disconnected
 * account's credentials to stay resolvable for as long as its original charges might still need
 * refunding.
 */
const restaurantPaymentAccountSchema = new Schema(
  {
    // No field-level index:true here — the partial unique index below already indexes
    // restaurantId (mirrors DomainMapping.ts's identical locationId precedent exactly; a separate
    // plain index here would just duplicate it, per that file's own comment on this trap).
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    provider: { type: String, enum: ["stripe", "safepay"], required: true },
    status: {
      type: String,
      enum: ["pending_verification", "active", "invalid", "disconnected"],
      default: "pending_verification",
      required: true,
    },
    encryptedCredentials: {
      ciphertext: { type: String, required: true },
      iv: { type: String, required: true },
      authTag: { type: String, required: true },
      keyVersion: { type: Number, required: true },
    },
    // Display-safe, never reversible — e.g. "sk_test_····4242" — lets the settings page show
    // "which key is connected" without ever storing or returning anything that could be replayed.
    credentialFingerprint: { type: String, required: true },
    lastVerifiedAt: { type: Date },
    // Generic/safe message only — never the raw provider error body, which can echo back
    // fragments of the submitted key in some providers' validation error responses.
    lastVerificationError: { type: String },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    toJSON: {
      ...idTransform,
      transform(doc, ret) {
        idTransform.transform(doc, ret as Record<string, unknown>);
        delete (ret as Record<string, unknown>).encryptedCredentials;
        return ret;
      },
    },
  }
);

// At most one ACTIVE account per restaurant — a real DB constraint, not just application
// discipline, so a race between two "connect" requests can never leave two live accounts for the
// same restaurant. Also structurally rules out two providers being simultaneously active for one
// restaurant. A pending_verification/invalid row is still allowed to coexist with the currently
// active one (the reconnect/replace flow), same as DomainMapping's equivalent index.
restaurantPaymentAccountSchema.index({ restaurantId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

export type RestaurantPaymentAccountDoc = InferSchemaType<typeof restaurantPaymentAccountSchema>;
export const RestaurantPaymentAccount = model<RestaurantPaymentAccountDoc>(
  "RestaurantPaymentAccount",
  restaurantPaymentAccountSchema
);
