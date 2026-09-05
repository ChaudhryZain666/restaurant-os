import { Schema, model, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * A restaurant's OWN connection to a third-party courier-dispatch provider — mirrors
 * RestaurantPaymentAccount.ts's exact shape and reasoning (a separate collection, not a Restaurant
 * subdocument, so an encrypted credential never sits on the frequently-fetched Restaurant document;
 * scoped per LOCATION, not per business, matching DomainMapping/RestaurantPaymentAccount's own
 * granularity — a multi-location business can connect a different account per location, or reuse
 * the same real-world credentials across several by entering them more than once).
 *
 * There is deliberately no row for `provider: "manual"` — a restaurant's own fleet needs no
 * account, no credentials, no verification step; it's simply always available. This collection
 * only ever holds THIRD-PARTY provider connections.
 */
const restaurantDeliveryProviderAccountSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    provider: { type: String, enum: ["uber_direct"], required: true },
    status: {
      type: String,
      enum: ["pending_verification", "active", "invalid", "disconnected"],
      default: "pending_verification",
      required: true,
    },
    // AES-256-GCM envelope (utils/credentialEncryption.ts) — never queried/indexed on, only
    // decrypted at the exact point of use (deliveryProviders/restaurantDeliveryProvider.ts). Never
    // present in any API response: the toJSON transform below strips it unconditionally.
    encryptedCredentials: {
      ciphertext: { type: String },
      iv: { type: String },
      authTag: { type: String },
      keyVersion: { type: Number },
    },
    // Display-safe, never reversible — e.g. "customer_id ····4a2f" — lets the settings page show
    // "which account is connected" without ever storing or returning anything replayable.
    credentialFingerprint: { type: String },
    lastVerifiedAt: { type: Date },
    // Generic/safe message only — never the raw provider error body.
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

// At most one ACTIVE account per restaurant per provider — mirrors RestaurantPaymentAccount's
// exact partial-unique-index precedent, so a race between two "connect" requests can never leave
// two live accounts for the same restaurant+provider pair.
restaurantDeliveryProviderAccountSchema.index(
  { restaurantId: 1, provider: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);

export type RestaurantDeliveryProviderAccountDoc = InferSchemaType<typeof restaurantDeliveryProviderAccountSchema>;
export const RestaurantDeliveryProviderAccount = model<RestaurantDeliveryProviderAccountDoc>(
  "RestaurantDeliveryProviderAccount",
  restaurantDeliveryProviderAccountSchema
);
