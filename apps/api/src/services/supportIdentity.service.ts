import type { SupportIdentity } from "@restaurant/types";
import type { RestaurantDoc } from "../models/Restaurant.js";

const PLATFORM_SUPPORT_NAME = "Platform Support";

/**
 * The single integration point for "what support identity should a customer-facing UI show".
 *
 * Today this always returns the platform identity: `Restaurant` has no white-label/branding
 * configuration field and no Agency relationship exists anywhere in this codebase (confirmed by
 * repo-wide search before this phase was built) — so there is nothing to conditionally brand on
 * yet. This function exists so that once white-label configuration IS added (e.g. a future
 * `restaurant.settings.supportBrandName` field, or an Agency record with its own support
 * identity), every ticket/KB/widget response that already calls this function picks it up
 * automatically, with no changes needed anywhere else. See docs/support-architecture.md.
 *
 * Internal/platform-support-facing views must NOT call this — they should see the true
 * underlying restaurant/relationship context directly, never the customer-facing identity.
 */
export function getSupportIdentity(_restaurant?: RestaurantDoc | null): SupportIdentity {
  return { name: PLATFORM_SUPPORT_NAME, isWhiteLabel: false };
}
