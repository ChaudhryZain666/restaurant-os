import type { MarketplaceProviderName } from "@restaurant/types";
import { RestaurantMarketplaceIntegration, type RestaurantMarketplaceIntegrationDoc } from "../models/RestaurantMarketplaceIntegration.js";
import { getMarketplaceProvider } from "./index.js";
import type { MarketplaceProvider } from "./MarketplaceProvider.js";

/** Every marketplace adapter authenticates with GarnishTable's own platform-level credentials (see
 *  RestaurantMarketplaceIntegration.ts's header comment) — building one never depends on which
 *  specific integration record it's for, unlike buildProviderFromAccount/
 *  buildDeliveryProviderFromAccount's BYOC per-account decryption. This helper exists anyway, as
 *  the single call site every consumer uses, so that changes to what "build a provider for this
 *  integration" means (e.g. a future provider that DOES need a stored per-account secret) have one
 *  place to land. */
export function buildMarketplaceProviderFromIntegration(integration: RestaurantMarketplaceIntegrationDoc): MarketplaceProvider {
  return getMarketplaceProvider(integration.provider as MarketplaceProviderName);
}

/** The webhook-time lookup: POST /webhooks/marketplace/:provider is ONE centralized endpoint for
 *  every restaurant (see marketplaceWebhook.controller.ts's header comment on why — none of the
 *  three providers sign with a per-restaurant secret) — this resolves which integration a verified
 *  payload concerns from the store id it carries, exactly like handleStripeConnectWebhook resolves
 *  a connected account from `event.account`. Only an ACTIVE integration resolves; a disconnected or
 *  invalid one is treated as "unknown" so a stale webhook from a store that was since disconnected
 *  is acknowledged and ignored, never processed. */
export async function resolveMarketplaceIntegrationByExternalStore(
  provider: MarketplaceProviderName,
  externalStoreId: string
): Promise<RestaurantMarketplaceIntegrationDoc | null> {
  return RestaurantMarketplaceIntegration.findOne({ provider, externalStoreId, status: "active" });
}
