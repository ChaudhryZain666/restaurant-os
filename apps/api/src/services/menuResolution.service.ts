import { Category } from "../models/Category.js";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { CategoryLocationOverride } from "../models/CategoryLocationOverride.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";

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
