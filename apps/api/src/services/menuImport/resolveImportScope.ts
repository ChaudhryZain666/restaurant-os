import { Restaurant } from "../../models/Restaurant.js";
import { MenuItem } from "../../models/MenuItem.js";
import { businessHasCanonicalMenu } from "../menuResolution.service.js";
import type { ImportScope } from "./resolveImport.js";

/**
 * Phase 30 — deliberately NOT just `resolveCanonicalBusinessId` (menuResolution.service.ts), which
 * only reports "canonical" once a canonical MenuItem already exists — correct for read paths, but
 * dangerous for an IMPORT: the current admin UI (MenuManagementPage.tsx) writes exclusively via
 * the canonical, businessId-scoped endpoints, never the legacy restaurantId-scoped ones. If this
 * importer wrote legacy items for a restaurant that has none yet, and the owner then added or
 * edited a single item through the normal editor afterward, resolveMenuForLocation's businessId-
 * only read would make every imported item invisible the moment that first canonical write flips
 * the switch (see menuResolution.service.ts's businessHasCanonicalMenu bootstrapping comment).
 *
 * Resolution order:
 *  1. Already canonical (a canonical item exists) -> canonical. Matches today's behavior exactly.
 *  2. Not canonical yet, but the restaurant already has real legacy (restaurantId-scoped) items ->
 *     legacy. Importing canonical here would orphan those pre-existing items the same way, just in
 *     the opposite direction — so this preserves whatever is already visible today.
 *  3. Neither canonical nor legacy items exist (a genuinely empty menu — the common "fast
 *     onboarding for a brand-new restaurant" case this importer primarily exists for) -> canonical,
 *     since that's what the FIRST item this restaurant will ever get through the normal admin UI
 *     would be anyway. Never revives the legacy write path for a restaurant that would otherwise
 *     start canonical.
 */
export async function resolveImportScope(restaurantId: string): Promise<ImportScope> {
  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  const businessId = restaurant?.businessId?.toString();
  if (!businessId) return { restaurantId, canonicalBusinessId: undefined };

  if (await businessHasCanonicalMenu(businessId)) {
    return { restaurantId, canonicalBusinessId: businessId };
  }

  const hasLegacyItems = await MenuItem.exists({ restaurantId });
  if (hasLegacyItems) return { restaurantId, canonicalBusinessId: undefined };

  return { restaurantId, canonicalBusinessId: businessId };
}
