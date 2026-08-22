import { Types } from "mongoose";
import type { CreateOrderInput } from "@restaurant/validation";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
import { Restaurant } from "../models/Restaurant.js";
import { MenuItemLocationOverride } from "../models/MenuItemLocationOverride.js";
import { ModifierGroupLocationOverride } from "../models/ModifierGroupLocationOverride.js";
import { businessHasCanonicalMenu } from "./menuResolution.service.js";
import { ApiError } from "../utils/ApiError.js";

export interface PricedSelectedModifier {
  groupId: Types.ObjectId;
  groupName: string;
  optionId: Types.ObjectId;
  optionName: string;
  priceAdjustment: number;
}

export interface PricedOrderItem {
  menuItemId: Types.ObjectId;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: PricedSelectedModifier[];
  lineTotal: number;
  specialInstructions?: string;
}

/** The subset of a menu item's fields pricing actually needs, already resolved to whatever this
 *  specific location's customer would actually be charged — the legacy and canonical resolution
 *  paths both produce this same shape so everything below this point doesn't need to know which
 *  path ran. */
interface EffectivePricingItem {
  _id: Types.ObjectId;
  name: string;
  price: number;
}

interface EffectivePricingOption {
  _id: Types.ObjectId;
  name: string;
  priceAdjustment: number;
  isActive: boolean;
}

interface EffectivePricingGroup {
  _id: Types.ObjectId;
  menuItemId: Types.ObjectId;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: EffectivePricingOption[];
}

/**
 * Legacy (pre-Phase-20) resolution — byte-for-byte the same query this function always ran. This
 * is the tenant-isolation guard's original form: `{_id, restaurantId}` compound equality is the
 * entire proof that a menu item belongs to this restaurant. Used whenever the business hasn't
 * been migrated to the canonical/override architecture yet (see priceOrderItems below).
 */
async function loadEffectiveMenuItemsLegacy(
  restaurantId: string,
  menuItemIds: string[]
): Promise<Map<string, EffectivePricingItem>> {
  const docs = await MenuItem.find({ _id: { $in: menuItemIds }, restaurantId, isAvailable: true });
  return new Map(docs.map((d) => [d.id, { _id: d._id, name: d.name, price: d.price }]));
}

async function loadEffectiveModifierGroupsLegacy(
  restaurantId: string,
  menuItemIds: string[]
): Promise<Map<string, EffectivePricingGroup>> {
  const docs = await ModifierGroup.find({ menuItemId: { $in: menuItemIds }, restaurantId, isActive: true });
  return new Map(
    docs.map((d) => [
      d.id,
      {
        _id: d._id,
        menuItemId: d.menuItemId,
        name: d.name,
        minSelect: d.minSelect,
        maxSelect: d.maxSelect,
        options: d.options.map((o) => ({ _id: o._id, name: o.name, priceAdjustment: o.priceAdjustment, isActive: o.isActive })),
      },
    ])
  );
}

/**
 * Phase 20 canonical resolution — replaces the single `{_id, restaurantId}` guard with a two-step
 * proof: (1) the item genuinely belongs to this BUSINESS (`{_id, businessId}`), and independently
 * (2) it resolves to effectively available at THIS location once its override (if any) is
 * applied. Step 2 is never implied by step 1 — an item merely existing somewhere in the business
 * (e.g. available at a sibling location) is never sufficient; only this location's own effective
 * isAvailable counts. A canonical item hidden here (whether by canonical default with no override,
 * or by an explicit override turning it off) is simply absent from the returned map, which the
 * caller's existing size-mismatch check already treats as "unavailable or doesn't exist."
 */
async function loadEffectiveMenuItemsCanonical(
  businessId: string,
  locationId: string,
  menuItemIds: string[]
): Promise<Map<string, EffectivePricingItem>> {
  const [docs, overrides] = await Promise.all([
    MenuItem.find({ _id: { $in: menuItemIds }, businessId }),
    MenuItemLocationOverride.find({ locationId, menuItemId: { $in: menuItemIds } }),
  ]);
  const overrideByItemId = new Map(overrides.map((o) => [o.menuItemId.toString(), o]));

  const result = new Map<string, EffectivePricingItem>();
  for (const doc of docs) {
    const override = overrideByItemId.get(doc.id);
    const isAvailable = override?.isAvailable ?? doc.isAvailable;
    if (!isAvailable) continue;
    result.set(doc.id, { _id: doc._id, name: doc.name, price: override?.priceOverride ?? doc.price });
  }
  return result;
}

async function loadEffectiveModifierGroupsCanonical(
  businessId: string,
  locationId: string,
  menuItemIds: string[]
): Promise<Map<string, EffectivePricingGroup>> {
  const docs = await ModifierGroup.find({ menuItemId: { $in: menuItemIds }, businessId });
  const overrides = await ModifierGroupLocationOverride.find({
    locationId,
    modifierGroupId: { $in: docs.map((d) => d._id) },
  });
  const overrideByGroupId = new Map(overrides.map((o) => [o.modifierGroupId.toString(), o]));

  const result = new Map<string, EffectivePricingGroup>();
  for (const doc of docs) {
    const override = overrideByGroupId.get(doc.id);
    const isActive = override?.isActive ?? doc.isActive;
    if (!isActive) continue;
    const optionOverrideByOptionId = new Map((override?.optionOverrides ?? []).map((o) => [o.optionId.toString(), o]));
    const options = doc.options.map((o) => {
      const optOverride = optionOverrideByOptionId.get(o._id.toString());
      return {
        _id: o._id,
        name: o.name,
        priceAdjustment: optOverride?.priceAdjustmentOverride ?? o.priceAdjustment,
        isActive: optOverride?.isActive ?? o.isActive,
      };
    });
    result.set(doc.id, { _id: doc._id, menuItemId: doc.menuItemId, name: doc.name, minSelect: doc.minSelect, maxSelect: doc.maxSelect, options });
  }
  return result;
}

/**
 * Turns client-submitted { menuItemId, quantity, selectedModifiers: [{groupId, optionId}] }
 * into fully-priced, server-verified order lines. Every price, name, and modifier-group
 * membership is re-derived from the database here — nothing from the request body is trusted
 * except which menu item and which option IDs the customer picked.
 *
 * Phase 20: dual-path. Whether this restaurant's business has been migrated to the canonical
 * menu/override architecture is checked once per call (one cheap indexed exists() check via
 * businessHasCanonicalMenu) — pre-migration businesses get byte-for-byte the same legacy query
 * this function always ran, so this is safe to deploy before any migration ever runs.
 */
export async function priceOrderItems(
  restaurantId: string,
  items: CreateOrderInput["items"]
): Promise<{ items: PricedOrderItem[]; subtotal: number }> {
  const menuItemIds = items.map((i) => i.menuItemId);

  const restaurant = await Restaurant.findById(restaurantId).select("businessId");
  const businessId = restaurant?.businessId?.toString();
  const useCanonical = Boolean(businessId) && (await businessHasCanonicalMenu(businessId!));

  const menuItemById = useCanonical
    ? await loadEffectiveMenuItemsCanonical(businessId!, restaurantId, menuItemIds)
    : await loadEffectiveMenuItemsLegacy(restaurantId, menuItemIds);
  if (menuItemById.size !== new Set(menuItemIds).size) {
    throw ApiError.badRequest("One or more menu items are unavailable or do not exist for this restaurant");
  }

  // Fetched by menuItemId, not by the groupIds the client selected — a client that omits a
  // required group entirely (sends no selection for it) must still be caught below, which only
  // works if that group was actually loaded.
  const groupById = useCanonical
    ? await loadEffectiveModifierGroupsCanonical(businessId!, restaurantId, menuItemIds)
    : await loadEffectiveModifierGroupsLegacy(restaurantId, menuItemIds);

  const pricedItems: PricedOrderItem[] = items.map((item) => {
    const menuItem = menuItemById.get(item.menuItemId)!;

    const selectionsByGroup = new Map<string, typeof item.selectedModifiers>();
    for (const selection of item.selectedModifiers) {
      const group = groupById.get(selection.groupId);
      if (!group || group.menuItemId.toString() !== item.menuItemId) {
        throw ApiError.badRequest(
          `Modifier group ${selection.groupId} does not belong to menu item ${item.menuItemId}`
        );
      }
      const existing = selectionsByGroup.get(selection.groupId);
      if (existing) existing.push(selection);
      else selectionsByGroup.set(selection.groupId, [selection]);
    }

    const selectedModifiers: PricedSelectedModifier[] = [];
    for (const [groupId, selections] of selectionsByGroup) {
      const group = groupById.get(groupId)!;
      if (selections.length < group.minSelect || selections.length > group.maxSelect) {
        throw ApiError.badRequest(
          `Modifier group "${group.name}" requires between ${group.minSelect} and ${group.maxSelect} selection(s)`
        );
      }
      for (const selection of selections) {
        const option = group.options.find(
          (o) => o._id.toString() === selection.optionId && o.isActive
        );
        if (!option) {
          throw ApiError.badRequest(`Modifier option ${selection.optionId} is invalid or unavailable`);
        }
        selectedModifiers.push({
          groupId: group._id,
          groupName: group.name,
          optionId: option._id,
          optionName: option.name,
          priceAdjustment: option.priceAdjustment,
        });
      }
    }

    // Every required group (minSelect > 0) must have at least one selection.
    for (const group of groupById.values()) {
      if (group.menuItemId.toString() === item.menuItemId && group.minSelect > 0 && !selectionsByGroup.has(group._id.toString())) {
        throw ApiError.badRequest(`Modifier group "${group.name}" requires a selection`);
      }
    }

    const modifierTotal = selectedModifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
    const lineTotal = (menuItem.price + modifierTotal) * item.quantity;

    return {
      menuItemId: menuItem._id,
      name: menuItem.name,
      unitPrice: menuItem.price,
      quantity: item.quantity,
      selectedModifiers,
      lineTotal,
      // Free text, never validated/priced — passed through as-is from the request.
      specialInstructions: item.specialInstructions,
    };
  });

  const subtotal = pricedItems.reduce((sum, i) => sum + i.lineTotal, 0);
  return { items: pricedItems, subtotal };
}
