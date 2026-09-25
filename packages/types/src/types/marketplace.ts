/**
 * Marketplace order-ingestion foundation (Uber Eats / DoorDash / foodpanda) — a different concern
 * from `types/delivery.ts`'s `DeliveryProviderName`/`Delivery`, which is COURIER DISPATCH (getting
 * a driver to carry an already-placed order). This is about a marketplace app placing the order in
 * the first place. Never conflate the two: DoorDash Marketplace (here) and DoorDash Drive (a
 * courier-dispatch provider, not yet built) are separate DoorDash products with separate APIs.
 *
 * Credentials for all three are platform-level, not restaurant-BYOC (see
 * RestaurantMarketplaceIntegration's own doc comment in apps/api for the full reasoning) — the
 * per-restaurant piece is always just an `externalStoreId` under GarnishTable's own
 * partner-level app registration.
 */
export const MARKETPLACE_PROVIDER_NAMES = ["uber_eats", "doordash", "foodpanda"] as const;
export type MarketplaceProviderName = (typeof MARKETPLACE_PROVIDER_NAMES)[number];

// Phase 78 — action_required mirrors RestaurantPaymentAccount's exact meaning (connected but something
// needs the owner's attention, e.g. an OAuth token expired mid-lifetime). pending_provider_approval is
// the honest state for a provider whose connect mechanism is "not_available"/"platform_admin_managed" —
// see MarketplaceProviderCapabilities.connect below — never a fake "connected" row.
export const MARKETPLACE_INTEGRATION_STATUSES = [
  "pending_verification",
  "active",
  "action_required",
  "pending_provider_approval",
  "invalid",
  "disconnected",
] as const;
export type MarketplaceIntegrationStatus = (typeof MARKETPLACE_INTEGRATION_STATUSES)[number];

export interface RestaurantMarketplaceIntegration {
  id: string;
  restaurantId: string;
  businessId: string;
  provider: MarketplaceProviderName;
  status: MarketplaceIntegrationStatus;
  externalStoreId?: string;
  /** Display-safe, never reversible — same fingerprint-not-secret pattern as
   *  RestaurantPaymentAccount/RestaurantDeliveryProviderAccount. Only ever set for uber_eats, the
   *  one provider whose per-store OAuth token this platform actually stores. */
  credentialFingerprint?: string;
  lastVerifiedAt?: string;
  lastVerificationError?: string;
  lastMenuSyncedAt?: string;
  lastMenuSyncError?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MarketplaceMenuMappingType = "category" | "menu_item" | "modifier_group" | "modifier_option";

export interface MarketplaceMenuMapping {
  id: string;
  integrationId: string;
  restaurantId: string;
  provider: MarketplaceProviderName;
  internalType: MarketplaceMenuMappingType;
  internalId: string;
  externalId: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

// Phase 78 — how a restaurant owner actually connects to this provider, never a raw credential form:
//  - "oauth_redirect": a real merchant-facing OAuth flow exists (Uber Eats only, today) — the owner
//    clicks Connect, signs in on the provider's own site, and is redirected back.
//  - "manual_store_id": the sanctioned MARKETPLACE_PROVIDER_MODE=mock dev/test backdoor only — never
//    the real UX for a live provider.
//  - "platform_admin_managed": no merchant-facing mechanism exists at all (foodpanda) — GarnishTable's
//    own team completes the connection on the restaurant's behalf once provider access is available.
//  - "not_available": a real merchant-facing mechanism exists on the provider's side (DoorDash's SSIO)
//    but this deployment can't build against it yet (unconfirmed technical details / no partner
//    access) — shown honestly as "coming soon," never faked.
export type MarketplaceConnectMechanism = "oauth_redirect" | "manual_store_id" | "platform_admin_managed" | "not_available";

export interface MarketplaceConnectCapability {
  mechanism: MarketplaceConnectMechanism;
  /** Human-facing only (shown as helper text under a disabled/pending Connect button) — never a raw
   *  provider error or internal detail. Present for "not_available"/"platform_admin_managed". */
  unavailableReason?: string;
}

/**
 * A capability declaration, not a fixed interface every adapter must fully implement — providers
 * genuinely differ (e.g. foodpanda's Catalog API has no per-item availability toggle the way Uber
 * Eats does). Callers check `capabilities` before invoking an optional operation rather than
 * catching a "not supported" throw as the normal path.
 */
export interface MarketplaceProviderCapabilities {
  menuSync: boolean;
  itemAvailabilityUpdate: boolean;
  orderAccept: boolean;
  orderDeny: boolean;
  connect: MarketplaceConnectCapability;
}

/** Order provenance for a marketplace-sourced order — see Order.marketplace's doc comment in
 *  apps/api/src/models/Order.ts for why this is a sibling of `channel`, not a replacement for it. */
export interface OrderMarketplaceProvenance {
  provider: MarketplaceProviderName;
  integrationId: string;
  externalOrderId: string;
  externalStoreId: string;
  externalStatus?: string;
  externalCreatedAt?: string;
}
