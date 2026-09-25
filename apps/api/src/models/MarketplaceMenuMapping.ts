import { Schema, model, Types, type InferSchemaType } from "mongoose";
import { idTransform } from "../utils/schemaOptions.js";

/**
 * Maps a canonical menu entity (Category/MenuItem/ModifierGroup/modifier option) to its external id
 * on one marketplace provider — a dedicated collection, not an embedded array on
 * RestaurantMarketplaceIntegration, mirroring MenuItemLocationOverride.ts's established "separate
 * collection per divergence-from-canonical concern" pattern (also keeps a potentially-large,
 * frequently-growing dataset off the integration document's own toJSON payload — the same
 * off-the-parent-doc reasoning RestaurantPaymentAccount.ts's design comment gives for
 * encryptedCredentials, applied here to bulk data instead of a secret).
 *
 * Two independent unique indexes back the two directions this mapping is actually read in:
 * menu-sync (marketplaceMenuSync.service.ts, "what's the external id for this internal item") and
 * order-ingestion (marketplaceOrderIngestion.service.ts, "resolve this inbound external item id" —
 * the direction under Uber Eats' 11.5-minute accept/deny time pressure).
 */
const marketplaceMenuMappingSchema = new Schema(
  {
    integrationId: { type: Schema.Types.ObjectId, ref: "RestaurantMarketplaceIntegration", required: true },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
    provider: { type: String, enum: ["uber_eats", "doordash", "foodpanda"], required: true },
    internalType: { type: String, enum: ["category", "menu_item", "modifier_group", "modifier_option"], required: true },
    internalId: { type: Schema.Types.ObjectId, required: true },
    externalId: { type: String, required: true },
    lastSyncedAt: { type: Date },
    lastSyncError: { type: String },
  },
  { timestamps: true, toJSON: idTransform }
);

marketplaceMenuMappingSchema.index({ integrationId: 1, internalType: 1, internalId: 1 }, { unique: true });
marketplaceMenuMappingSchema.index({ integrationId: 1, internalType: 1, externalId: 1 }, { unique: true });

export type MarketplaceMenuMappingDoc = InferSchemaType<typeof marketplaceMenuMappingSchema> & { _id: Types.ObjectId };
export const MarketplaceMenuMapping = model<MarketplaceMenuMappingDoc>(
  "MarketplaceMenuMapping",
  marketplaceMenuMappingSchema
);
