import type { ClientSession, Types } from "mongoose";
import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import { businessHasCanonicalMenu } from "./menuResolution.service.js";

/**
 * Phase 20 — for a business already on the canonical/override architecture, "clone this
 * location's menu" no longer means copying documents (a new location has no independent
 * documents to copy INTO — it already inherits the entire canonical menu automatically, for
 * free). Instead it means: reproduce the source location's current DIVERGENCES from canonical at
 * the new location too. A location's own override rows already ARE exactly that divergence set,
 * so this is a direct copy of the source location's override rows onto the target location —
 * canonical fields (name/description/etc.) were never overridable in the first place, so there's
 * nothing to copy for them. The new location still receives every future canonical addition/edit
 * automatically, exactly like any other location — cloning only front-loads a divergence
 * snapshot, it never severs the business relationship.
 */
async function seedLocationOverridesFromSource(
  businessId: Types.ObjectId,
  sourceLocationId: Types.ObjectId,
  targetLocationId: Types.ObjectId,
  session: ClientSession
): Promise<void> {
  const [categoryOverrides, menuItemOverrides, modifierGroupOverrides] = await Promise.all([
    CategoryLocationOverride.find({ locationId: sourceLocationId }).session(session),
    MenuItemLocationOverride.find({ locationId: sourceLocationId }).session(session),
    ModifierGroupLocationOverride.find({ locationId: sourceLocationId }).session(session),
  ]);

  if (categoryOverrides.length > 0) {
    await CategoryLocationOverride.insertMany(
      categoryOverrides.map((o) => ({
        businessId,
        locationId: targetLocationId,
        categoryId: o.categoryId,
        isActive: o.isActive,
        sortOrderOverride: o.sortOrderOverride,
      })),
      { session }
    );
  }

  if (menuItemOverrides.length > 0) {
    await MenuItemLocationOverride.insertMany(
      menuItemOverrides.map((o) => ({
        businessId,
        locationId: targetLocationId,
        menuItemId: o.menuItemId,
        isAvailable: o.isAvailable,
        priceOverride: o.priceOverride,
        sortOrderOverride: o.sortOrderOverride,
      })),
      { session }
    );
  }

  if (modifierGroupOverrides.length > 0) {
    await ModifierGroupLocationOverride.insertMany(
      modifierGroupOverrides.map((o) => ({
        businessId,
        locationId: targetLocationId,
        modifierGroupId: o.modifierGroupId,
        isActive: o.isActive,
        optionOverrides: o.optionOverrides,
      })),
      { session }
    );
  }
}

/**
 * Phase 19 (legacy path, still used by not-yet-migrated businesses) — a one-time copy of a
 * location's menu (Category -> MenuItem -> ModifierGroup, in that dependency order) into a
 * brand-new location. Produces fully independent documents with new ids — there is no ongoing
 * sharing/sync after this runs. Kept as the dormant fallback for any business that hasn't been
 * through Phase 20's migration yet (see cloneMenuToRestaurant below) — once a business has a
 * canonical menu, this path is never reached for it again.
 */
async function cloneMenuDocumentsToRestaurant(
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

/**
 * Phase 20 entry point (see business.controller.ts's createLocationForBusiness) — dual-path,
 * exactly like orderPricing.service.ts and menu.controller.ts's reads: a business already
 * migrated to the canonical/override architecture gets the new override-seeding behavior; a
 * not-yet-migrated business gets byte-for-byte the same whole-document clone this always did.
 * Runs entirely within the caller's transaction/session so a failure partway through rolls back
 * cleanly alongside the new location's own creation.
 */
export async function cloneMenuToRestaurant(
  businessId: Types.ObjectId,
  sourceRestaurantId: Types.ObjectId,
  targetRestaurantId: Types.ObjectId,
  session: ClientSession
): Promise<void> {
  const useCanonical = await businessHasCanonicalMenu(businessId.toString());
  if (useCanonical) {
    await seedLocationOverridesFromSource(businessId, sourceRestaurantId, targetRestaurantId, session);
    return;
  }
  await cloneMenuDocumentsToRestaurant(sourceRestaurantId, targetRestaurantId, session);
}
