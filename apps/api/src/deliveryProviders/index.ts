import { ManualDispatchProvider } from "./ManualDispatchProvider.js";
import type { DeliveryProvider } from "./DeliveryProvider.js";

export const KNOWN_DELIVERY_PROVIDER_NAMES = ["manual", "uber_direct"] as const;
export type KnownDeliveryProviderName = (typeof KNOWN_DELIVERY_PROVIDER_NAMES)[number];

// "manual" is the one delivery provider with no restaurant-specific credentials at all — a single
// process-wide instance is correct and sufficient, same lazy-singleton shape as
// payments/index.ts's getPaymentProvider()/geocoding/index.ts's getGeocodingService(). "uber_direct"
// has no equivalent platform-wide singleton: every restaurant needs its own Uber-issued
// client/customer credentials (BYOC-only, like RestaurantPaymentAccount) — see
// restaurantDeliveryProvider.ts, the actual entry point deliveryDispatch.service.ts calls.
let manualInstance: ManualDispatchProvider | null = null;

export function getManualDeliveryProvider(): DeliveryProvider {
  if (!manualInstance) manualInstance = new ManualDispatchProvider();
  return manualInstance;
}

export * from "./DeliveryProvider.js";
