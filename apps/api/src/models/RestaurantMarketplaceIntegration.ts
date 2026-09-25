import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * A restaurant's connection to a marketplace order-ingestion provider (Uber Eats/DoorDash/
 * foodpanda) — a different concern from RestaurantDeliveryProviderAccount.ts (courier dispatch).
 * Structurally mirrors that model (separate collection, never a Restaurant subdocument, so an
 * encrypted credential never sits on the frequently-fetched Restaurant document; scoped per
 * LOCATION, matching DomainMapping/RestaurantPaymentAccount/RestaurantDeliveryProviderAccount's own
 * granularity), but the CREDENTIAL MODEL is deliberately different — not BYOC.
 *
 * Researched directly against each provider's own current docs (see marketplaceProviders/ adapter
 * header comments for exactly what's verified vs inferred): Uber Eats' `client_credentials` grant,
 * DoorDash's signing key, and foodpanda's `client_credentials` token are all PLATFORM-level
 * (GarnishTable-as-partner, one registration for the whole deployment, in env vars — see
 * config/env.ts) — never a restaurant's own secret the way Stripe/Safepay/Uber Direct BYOC is. The
 * one per-restaurant piece every provider has is `externalStoreId` — every adapter's ongoing API
 * calls (menu push, order fetch, accept/deny) authenticate with the platform's own credentials and
 * simply pass `externalStoreId` as a path parameter (Uber Eats' own docs: "your app operates on
 * stores you're already connected to using your app's credentials" — the per-store
 * `authorization_code` merchant-activation redirect that precedes this only grants the app access
 * on Uber's side, it does not hand back a separate per-store token this platform needs to store).
 * `encryptedCredentials`/`credentialFingerprint` are therefore RESERVED, not currently populated by
 * any adapter in this phase — kept on the schema for a future provider/capability that genuinely
 * needs a stored per-restaurant secret, following the same field shape
 * RestaurantPaymentAccount/RestaurantDeliveryProviderAccount already establish, rather than adding
 * it later as a schema migration.
 */
const restaurantMarketplaceIntegrationSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, index: true },
    provider: { type: String, enum: ["uber_eats", "doordash", "foodpanda"], required: true },
    // Phase 78 — action_required mirrors RestaurantPaymentAccount's exact meaning (connected but
    // something needs the owner's attention). pending_provider_approval is the honest row created for
    // a provider whose connect mechanism is not_available/platform_admin_managed (DoorDash/foodpanda) —
    // never a fake "connected" state. See MarketplaceProviderCapabilities.connect in @restaurant/types.
    status: {
      type: String,
      enum: ["pending_verification", "active", "action_required", "pending_provider_approval", "invalid", "disconnected"],
      default: "pending_verification",
      required: true,
    },
    // The provider's own id for this store — set on connect, and the field every inbound webhook
    // is resolved by (see marketplaceProviders/restaurantMarketplaceProvider.ts). Not a secret.
    externalStoreId: { type: String },
    // AES-256-GCM envelope (utils/credentialEncryption.ts) — uber_eats only, see header comment
    // above. Never queried/indexed on, only decrypted at the exact point of use. Never present in
    // any API response: the toJSON transform below strips it unconditionally.
    encryptedCredentials: {
      ciphertext: { type: String },
      iv: { type: String },
      authTag: { type: String },
      keyVersion: { type: Number },
    },
    // Display-safe, never reversible — same pattern as RestaurantPaymentAccount/
    // RestaurantDeliveryProviderAccount. Absent for doordash/foodpanda (no credential to fingerprint).
    credentialFingerprint: { type: String },
    lastVerifiedAt: { type: Date },
    // Generic/safe message only — never the raw provider error body.
    lastVerificationError: { type: String },
    connectedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastMenuSyncedAt: { type: Date },
    lastMenuSyncError: { type: String },
    enabled: { type: Boolean, default: true },
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

// At most one ACTIVE integration per restaurant per provider — mirrors RestaurantPaymentAccount's/
// RestaurantDeliveryProviderAccount's exact partial-unique-index precedent.
restaurantMarketplaceIntegrationSchema.index(
  { restaurantId: 1, provider: 1 },
  { unique: true, partialFilterExpression: { status: "active" } }
);
// The webhook-time resolution index: none of the three providers sign with a per-restaurant secret
// (all platform-level — see header comment), so the single centralized webhook endpoint
// (POST /webhooks/marketplace/:provider) resolves which integration a payload concerns from its own
// store id, AFTER signature verification, exactly like handleStripeConnectWebhook resolves a
// connected account from `event.account`. Partial on externalStoreId actually being a string (not
// `sparse: true`) for the same reason Payment.ts's index isn't sparse either.
restaurantMarketplaceIntegrationSchema.index(
  { provider: 1, externalStoreId: 1 },
  { unique: true, partialFilterExpression: { externalStoreId: { $type: "string" } } }
);

export type RestaurantMarketplaceIntegrationDoc = InferSchemaType<typeof restaurantMarketplaceIntegrationSchema> & {
  _id: Types.ObjectId;
};
export const RestaurantMarketplaceIntegration = model<RestaurantMarketplaceIntegrationDoc>(
  "RestaurantMarketplaceIntegration",
  restaurantMarketplaceIntegrationSchema
);
