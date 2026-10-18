import type { SupportIdentity } from "@restaurant/types";
import type { RestaurantDoc } from "../models/Restaurant.js";

const PLATFORM_SUPPORT_NAME = "Platform Support";

/**
 * Fallback identity for customer-facing support surfaces. Agency-aware callers use
 * customerWhiteLabel.service.ts, which checks agency status, agency opt-in, and the exact
 * client-selected/offered feature before overriding this value.
 */
export function getSupportIdentity(_restaurant?: RestaurantDoc | null): SupportIdentity {
  return { name: PLATFORM_SUPPORT_NAME, isWhiteLabel: false };
}
