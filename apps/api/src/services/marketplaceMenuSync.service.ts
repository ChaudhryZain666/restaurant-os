import { RestaurantMarketplaceIntegration } from "../models/RestaurantMarketplaceIntegration.js";
import { MarketplaceMenuMapping } from "../models/MarketplaceMenuMapping.js";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { Restaurant } from "../models/Restaurant.js";
import { buildMarketplaceProviderFromIntegration } from "../marketplaceProviders/restaurantMarketplaceProvider.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";

/**
 * Pushes this restaurant's current canonical menu to one connected marketplace provider and writes
 * back the resulting external ids into MarketplaceMenuMapping. Reads whichever scope the restaurant
 * actually uses (legacy restaurantId-scoped or canonical businessId-scoped — see menuClone.service.ts
 * for the same dual-path precedent) rather than assuming canonical.
 */
export async function syncMenuToMarketplace(integrationId: string): Promise<{ categoriesSynced: number; itemsSynced: number }> {
  const integration = await RestaurantMarketplaceIntegration.findById(integrationId);
  if (!integration) throw ApiError.notFound("Marketplace integration not found");
  const externalStoreId = integration.externalStoreId as string | undefined;
  if (!externalStoreId) throw ApiError.badRequest("This integration has no connected store id yet");

  const restaurant = await Restaurant.findById(integration.restaurantId).select("businessId settings.currency");
  if (!restaurant) throw ApiError.notFound("Restaurant not found");

  const scopeFilter = restaurant.businessId ? { businessId: restaurant.businessId } : { restaurantId: integration.restaurantId };
  const [categories, items] = await Promise.all([
    Category.find({ ...scopeFilter, isActive: true }).sort({ sortOrder: 1 }),
    MenuItem.find({ ...scopeFilter, isAvailable: true }),
  ]);

  const existingMappings = await MarketplaceMenuMapping.find({ integrationId, internalType: { $in: ["category", "menu_item"] } });
  const existingByInternalId = new Map(existingMappings.map((m) => [m.internalId.toString(), m]));

  const adapter = buildMarketplaceProviderFromIntegration(integration);
  if (!adapter.capabilities.menuSync) {
    throw ApiError.badRequest(`${integration.provider} does not support menu sync`);
  }

  const currency = restaurant.settings?.currency ?? "USD";
  try {
    const result = await adapter.pushMenu({
      externalStoreId,
      categories: categories.map((c) => ({
        externalId: existingByInternalId.get(c.id as string)?.externalId,
        internalId: c.id as string,
        name: c.name,
        sortOrder: c.sortOrder ?? 0,
      })),
      items: items.map((i) => ({
        externalId: existingByInternalId.get(i.id as string)?.externalId,
        internalId: i.id as string,
        name: i.name,
        description: i.description,
        priceCents: Math.round(i.price * 100),
        currency,
        isAvailable: i.isAvailable,
        categoryExternalId: existingByInternalId.get(i.categoryId?.toString() ?? "")?.externalId ?? "",
      })),
    });

    await Promise.all([
      ...result.categories.map((c) =>
        MarketplaceMenuMapping.updateOne(
          { integrationId, internalType: "category", internalId: c.internalId },
          { $set: { restaurantId: integration.restaurantId, provider: integration.provider, externalId: c.externalId, lastSyncedAt: new Date() }, $unset: { lastSyncError: "" } },
          { upsert: true }
        )
      ),
      ...result.items.map((i) =>
        MarketplaceMenuMapping.updateOne(
          { integrationId, internalType: "menu_item", internalId: i.internalId },
          { $set: { restaurantId: integration.restaurantId, provider: integration.provider, externalId: i.externalId, lastSyncedAt: new Date() }, $unset: { lastSyncError: "" } },
          { upsert: true }
        )
      ),
    ]);

    await RestaurantMarketplaceIntegration.updateOne({ _id: integrationId }, { $set: { lastMenuSyncedAt: new Date() }, $unset: { lastMenuSyncError: "" } });
    return { categoriesSynced: result.categories.length, itemsSynced: result.items.length };
  } catch (err) {
    const message = (err as Error).message;
    await RestaurantMarketplaceIntegration.updateOne({ _id: integrationId }, { $set: { lastMenuSyncError: message } });
    logger.error("marketplace menu sync failed", { integrationId, provider: integration.provider, error: message });
    throw err;
  }
}
