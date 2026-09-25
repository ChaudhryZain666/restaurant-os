import type { MarketplaceProviderName } from "@restaurant/types";
import { env } from "../config/env.js";
import type { MarketplaceProvider } from "./MarketplaceProvider.js";
import { MockMarketplaceProvider } from "./MockMarketplaceProvider.js";
import { UberEatsProvider } from "./UberEatsProvider.js";
import { DoorDashProvider } from "./DoorDashProvider.js";
import { FoodpandaProvider } from "./FoodpandaProvider.js";

export const KNOWN_MARKETPLACE_PROVIDER_NAMES: MarketplaceProviderName[] = ["uber_eats", "doordash", "foodpanda"];

const instances = new Map<MarketplaceProviderName, MarketplaceProvider>();

function buildLiveProvider(name: MarketplaceProviderName): MarketplaceProvider {
  if (name === "uber_eats") {
    if (!env.UBER_EATS_CLIENT_ID || !env.UBER_EATS_CLIENT_SECRET) {
      throw new Error('Provider "uber_eats" requires UBER_EATS_CLIENT_ID and UBER_EATS_CLIENT_SECRET to both be set.');
    }
    return new UberEatsProvider(env.UBER_EATS_CLIENT_ID, env.UBER_EATS_CLIENT_SECRET);
  }
  if (name === "doordash") {
    if (!env.DOORDASH_DEVELOPER_ID || !env.DOORDASH_KEY_ID || !env.DOORDASH_SIGNING_SECRET) {
      throw new Error('Provider "doordash" requires DOORDASH_DEVELOPER_ID, DOORDASH_KEY_ID, and DOORDASH_SIGNING_SECRET to all be set.');
    }
    return new DoorDashProvider(env.DOORDASH_DEVELOPER_ID, env.DOORDASH_KEY_ID, env.DOORDASH_SIGNING_SECRET);
  }
  if (name === "foodpanda") {
    if (!env.FOODPANDA_CLIENT_ID || !env.FOODPANDA_CLIENT_SECRET || !env.FOODPANDA_WEBHOOK_TOKEN) {
      throw new Error('Provider "foodpanda" requires FOODPANDA_CLIENT_ID, FOODPANDA_CLIENT_SECRET, and FOODPANDA_WEBHOOK_TOKEN to all be set.');
    }
    return new FoodpandaProvider(env.FOODPANDA_CLIENT_ID, env.FOODPANDA_CLIENT_SECRET, env.FOODPANDA_WEBHOOK_TOKEN);
  }
  throw new Error(`"${name as string}" is not a recognized marketplace provider.`);
}

/**
 * Lazy-singleton-per-name registry, mirroring payments/index.ts's getPaymentProvider() exactly.
 * `MARKETPLACE_PROVIDER_MODE=mock` (the default — see env.ts) makes every provider name resolve to
 * a MockMarketplaceProvider standing in as that name, so the whole ingestion pipeline is genuinely
 * exercisable with zero real credentials; `=live` builds the real adapter and throws a clear,
 * specific error the first time it's actually used without its required env vars set — never at
 * boot, and never a fabricated "connected" state.
 */
export function getMarketplaceProvider(name: MarketplaceProviderName): MarketplaceProvider {
  const cached = instances.get(name);
  if (cached) return cached;
  const built = env.MARKETPLACE_PROVIDER_MODE === "mock" ? new MockMarketplaceProvider(name, env.MOCK_MARKETPLACE_WEBHOOK_SECRET) : buildLiveProvider(name);
  instances.set(name, built);
  return built;
}

/** Test/dev-only accessor for a mock provider's driver surface (simulateInboundOrder/signPayload)
 *  — throws unless MARKETPLACE_PROVIDER_MODE=mock, same guard as getMockPaymentProvider(). */
export function getMockMarketplaceProvider(name: MarketplaceProviderName): MockMarketplaceProvider {
  const provider = getMarketplaceProvider(name);
  if (!(provider instanceof MockMarketplaceProvider)) {
    throw new Error("The mock marketplace driver is only available when MARKETPLACE_PROVIDER_MODE=mock.");
  }
  return provider;
}

export * from "./MarketplaceProvider.js";
