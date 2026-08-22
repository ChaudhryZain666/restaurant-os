import type { ClientSession, Types } from "mongoose";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";

/**
 * Phase 19 — a one-time copy of a location's menu (Category -> MenuItem -> ModifierGroup, in that
 * dependency order) into a brand-new location, as an optional convenience when creating one (see
 * business.controller.ts's createLocationForBusiness). Produces fully independent documents with
 * new ids — there is no ongoing sharing/sync after this runs, and no ongoing coupling between the
 * source and target locations. This is deliberately NOT the target shared-canonical-item/override
 * architecture (see docs/multi-tenant-storefront-architecture.md's Phase 18 section) — that's a
 * real, separate, higher-risk schema migration; this is just a convenient starting point.
 *
 * Each copy records a clonedFrom*Id provenance field (internal-only, select:false — see the
 * models) purely as a migration hook for a future shared-menu architecture to detect "never
 * touched since cloning" vs "diverged" — nothing in the product reads it today.
 *
 * imageUrl is copied as a literal shared URL, not duplicated storage — intentional: the image
 * itself doesn't need to be re-uploaded per location just because the menu item record is copied.
 *
 * Runs entirely within the caller's transaction/session so a failure partway through rolls back
 * cleanly alongside the new location's own creation, rather than leaving a half-cloned menu behind.
 */
export async function cloneMenuToRestaurant(
  sourceRestaurantId: Types.ObjectId,
  targetRestaurantId: Types.ObjectId,
  session: ClientSession
): Promise<void> {
  const sourceCategories = await Category.find({ restaurantId: sourceRestaurantId }).session(session);
  const categoryIdMap = new Map<string, Types.ObjectId>();

  for (const source of sourceCategories) {
    const [created] = await Category.create(
      [
        {
          restaurantId: targetRestaurantId,
          name: source.name,
          description: source.description,
          sortOrder: source.sortOrder,
          isActive: source.isActive,
          clonedFromCategoryId: source._id,
        },
      ],
      { session }
    );
    categoryIdMap.set(source._id.toString(), created._id);
  }

  const sourceMenuItems = await MenuItem.find({ restaurantId: sourceRestaurantId }).session(session);
  const menuItemIdMap = new Map<string, Types.ObjectId>();

  for (const source of sourceMenuItems) {
    const targetCategoryId = categoryIdMap.get(source.categoryId.toString());
    if (!targetCategoryId) continue; // Shouldn't happen — every item's category was just cloned above.
    const [created] = await MenuItem.create(
      [
        {
          restaurantId: targetRestaurantId,
          categoryId: targetCategoryId,
          name: source.name,
          description: source.description,
          price: source.price,
          imageUrl: source.imageUrl,
          isAvailable: source.isAvailable,
          sortOrder: source.sortOrder,
          clonedFromMenuItemId: source._id,
        },
      ],
      { session }
    );
    menuItemIdMap.set(source._id.toString(), created._id);
  }

  const sourceModifierGroups = await ModifierGroup.find({ restaurantId: sourceRestaurantId }).session(session);
  for (const source of sourceModifierGroups) {
    const targetMenuItemId = menuItemIdMap.get(source.menuItemId.toString());
    if (!targetMenuItemId) continue;
    await ModifierGroup.create(
      [
        {
          restaurantId: targetRestaurantId,
          menuItemId: targetMenuItemId,
          name: source.name,
          minSelect: source.minSelect,
          maxSelect: source.maxSelect,
          isActive: source.isActive,
          sortOrder: source.sortOrder,
          // New _ids for options are generated automatically by Mongoose on insert.
          options: source.options.map((opt) => ({
            name: opt.name,
            priceAdjustment: opt.priceAdjustment,
            isActive: opt.isActive,
            sortOrder: opt.sortOrder,
          })),
          clonedFromModifierGroupId: source._id,
        },
      ],
      { session }
    );
  }
}
