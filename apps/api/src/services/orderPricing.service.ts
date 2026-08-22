import { Types } from "mongoose";
import type { CreateOrderInput } from "@restaurant/validation";
import { MenuItem } from "../models/MenuItem.js";
import { ModifierGroup } from "../models/ModifierGroup.js";
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

/**
 * Turns client-submitted { menuItemId, quantity, selectedModifiers: [{groupId, optionId}] }
 * into fully-priced, server-verified order lines. Every price, name, and modifier-group
 * membership is re-derived from the database here — nothing from the request body is trusted
 * except which menu item and which option IDs the customer picked.
 */
export async function priceOrderItems(
  restaurantId: string,
  items: CreateOrderInput["items"]
): Promise<{ items: PricedOrderItem[]; subtotal: number }> {
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await MenuItem.find({
    _id: { $in: menuItemIds },
    restaurantId,
    isAvailable: true,
  });
  const menuItemById = new Map(menuItems.map((m) => [m.id, m]));
  if (menuItemById.size !== new Set(menuItemIds).size) {
    throw ApiError.badRequest("One or more menu items are unavailable or do not exist for this restaurant");
  }

  // Fetched by menuItemId, not by the groupIds the client selected — a client that omits a
  // required group entirely (sends no selection for it) must still be caught below, which only
  // works if that group was actually loaded.
  const groups = await ModifierGroup.find({ menuItemId: { $in: menuItemIds }, restaurantId, isActive: true });
  const groupById = new Map(groups.map((g) => [g.id, g]));

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
    for (const group of groups) {
      if (group.menuItemId.toString() === item.menuItemId && group.minSelect > 0 && !selectionsByGroup.has(group.id)) {
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
