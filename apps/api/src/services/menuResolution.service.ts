import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import { ApiError } from "../utils/ApiError.js";

export interface ResolvedCategory {
  id: string;
  restaurantId: string;
  name: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface ResolvedModifierOption {
  id: string;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
  sortOrder: number;
}

export interface ResolvedModifierGroup {
  id: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: ResolvedModifierOption[];
}

export interface ResolvedMenuItem {
  id: string;
  restaurantId: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl?: string;
  isAvailable: boolean;
  sortOrder: number;
}

export interface ResolvedMenu {
  items: ResolvedMenuItem[];
  categories: ResolvedCategory[];
  modifierGroups: ResolvedModifierGroup[];
}

/**
 * Cheap existence check used to decide, per business, whether the canonical/override
 * architecture applies (migration has run) or whether callers should keep using today's
 * unchanged, restaurantId-scoped queries. Checked against MenuItem specifically — a business with
 * a canonical menu always has at least a Category from Phase 20's migration, but a business could
 * theoretically have categories with no items yet, so MenuItem is the more conservative signal
 * that would only be true post-migration. Kept intentionally simple (a single indexed exists()
 * check) rather than caching this — see docs/multi-tenant-storefront-architecture.md's Phase 20
 * section for why a second cache tier wasn't justified.
 */
export async function businessHasCanonicalMenu(businessId: string): Promise<boolean> {
  return Boolean(await MenuItem.exists({ businessId }));
}

/**
 * Phase 20/21 — the shared per-request check every dual-path menu call site (reads AND, since
 * Phase 21, writes) uses to decide whether a location's menu should go through the canonical +
 * override resolver or keep using the original restaurantId-scoped queries. Promoted here from
 * menu.controller.ts (where it started as a private helper) so category.controller.ts and
 * modifier.controller.ts — which had zero Phase 20 awareness — can share the same implementation
 * rather than each growing their own copy. Pre-migration businesses get `undefined`, meaning
 * "keep doing what this code already did."
 */
export async function resolveCanonicalBusinessId(restaurantId: string): Promise<string | undefined> {
  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  const businessId = restaurant?.businessId?.toString();
  if (!businessId) return undefined;
  return (await businessHasCanonicalMenu(businessId)) ? businessId : undefined;
}

/**
 * Phase 21 — the guard every legacy per-location write function (menu/category/modifier
 * controllers) starts with. Once a business is migrated, an anchor location's own documents ARE
 * the canonical documents (same _id, also carrying businessId), and a "promoted exclusive"
 * sibling document keeps its original restaurantId too — so a legacy `{_id, restaurantId}` write
 * filter would still silently match and mutate what is now a business-wide canonical document
 * through a request the caller believes is scoped to one location. That's an active
 * scope-violation risk, not just staleness, so this throws rather than falling through.
 * Runtime-checked per business (not a static route removal), so a business rolled back via
 * `$unset businessId` automatically gets its old endpoints back with no redeploy.
 */
export async function assertMenuNotMigrated(restaurantId: string): Promise<void> {
  const canonicalBusinessId = await resolveCanonicalBusinessId(restaurantId);
  if (canonicalBusinessId) {
    throw ApiError.gone(
      "This restaurant's menu is now managed at the business level. Use /businesses/:businessId/... instead.",
      { businessId: canonicalBusinessId }
    );
  }
}

/**
 * Phase 20 — the single authoritative merge of a business's canonical menu with one location's
 * overrides. Every read path that needs "the menu this location actually sells" (public
 * storefront, staff admin view, and — for pricing/availability specifically —
 * orderPricing.service.ts) goes through here so there is exactly one place this logic lives.
 *
 * `includeHidden: false` (the public/storefront case) drops anything whose EFFECTIVE
 * isActive/isAvailable is false — never the canonical default alone, since a location override
 * can flip either direction independent of canonical. `includeHidden: true` (staff) keeps
 * everything, mirroring today's listAllMenuItems' "all items including hidden" contract.
 *
 * The returned `restaurantId` on every entity is deliberately the requested `locationId`, not the
 * underlying `businessId` — apps/web/src/context/CartContext.tsx reads item.restaurantId as its
 * cross-restaurant cart-mixing guard, so this DTO field must keep meaning "which location this
 * came from," not "which business."
 */
export async function resolveMenuForLocation(
  businessId: string,
  locationId: string,
  options: { includeHidden: boolean }
): Promise<ResolvedMenu> {
  const { includeHidden } = options;

  const [categories, menuItems, modifierGroups, categoryOverrides, menuItemOverrides, modifierGroupOverrides] =
    await Promise.all([
      Category.find({ businessId }),
      MenuItem.find({ businessId }),
      ModifierGroup.find({ businessId }),
      CategoryLocationOverride.find({ locationId }),
      MenuItemLocationOverride.find({ locationId }),
      ModifierGroupLocationOverride.find({ locationId }),
    ]);

  const categoryOverrideById = new Map(categoryOverrides.map((o) => [o.categoryId.toString(), o]));
  const menuItemOverrideById = new Map(menuItemOverrides.map((o) => [o.menuItemId.toString(), o]));
  const modifierGroupOverrideById = new Map(modifierGroupOverrides.map((o) => [o.modifierGroupId.toString(), o]));

  const resolvedCategories: ResolvedCategory[] = categories
    .map((cat) => {
      const override = categoryOverrideById.get(cat.id);
      return {
        id: cat.id,
        restaurantId: locationId,
        name: cat.name,
        description: cat.description ?? undefined,
        sortOrder: override?.sortOrderOverride ?? cat.sortOrder,
        isActive: override?.isActive ?? cat.isActive,
      };
    })
    .filter((c) => includeHidden || c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const resolvedItems: ResolvedMenuItem[] = menuItems
    .map((item) => {
      const override = menuItemOverrideById.get(item.id);
      return {
        id: item.id,
        restaurantId: locationId,
        categoryId: item.categoryId.toString(),
        name: item.name,
        description: item.description ?? "",
        price: override?.priceOverride ?? item.price,
        imageUrl: item.imageUrl ?? undefined,
        isAvailable: override?.isAvailable ?? item.isAvailable,
        sortOrder: override?.sortOrderOverride ?? item.sortOrder,
      };
    })
    .filter((i) => includeHidden || i.isAvailable)
    .sort((a, b) => a.categoryId.localeCompare(b.categoryId) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const resolvedModifierGroups: ResolvedModifierGroup[] = modifierGroups
    .map((group) => {
      const groupOverride = modifierGroupOverrideById.get(group.id);
      const optionOverrideById = new Map(
        (groupOverride?.optionOverrides ?? []).map((o) => [o.optionId.toString(), o])
      );
      const options: ResolvedModifierOption[] = group.options
        .map((opt) => {
          const optOverride = optionOverrideById.get(opt._id.toString());
          return {
            id: opt._id.toString(),
            name: opt.name,
            priceAdjustment: optOverride?.priceAdjustmentOverride ?? opt.priceAdjustment,
            isActive: optOverride?.isActive ?? opt.isActive,
            sortOrder: opt.sortOrder,
          };
        })
        .filter((o) => includeHidden || o.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder);

      return {
        id: group.id,
        restaurantId: locationId,
        menuItemId: group.menuItemId.toString(),
        name: group.name,
        minSelect: group.minSelect,
        maxSelect: group.maxSelect,
        isActive: groupOverride?.isActive ?? group.isActive,
        sortOrder: group.sortOrder,
        options,
      };
    })
    .filter((g) => includeHidden || g.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return { items: resolvedItems, categories: resolvedCategories, modifierGroups: resolvedModifierGroups };
}
