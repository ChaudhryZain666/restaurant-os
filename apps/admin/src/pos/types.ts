import type { Category, MenuItem, ModifierGroup } from "@restaurant/types";

/** The exact shape GET /restaurants/:id/menu returns — unchanged from the original PosPage.tsx. */
export interface MenuResponse {
  items: MenuItem[];
  categories: Category[];
  modifierGroups: ModifierGroup[];
}

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}

export interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  selectedModifiers: SelectedModifier[];
  specialInstructions?: string;
}

/** Matches GET /restaurants/:id/customers's RestaurantCustomerSummary — only the fields the POS
 *  picker actually renders. */
export interface CustomerHit {
  customerId: string;
  name: string;
  email: string;
  phone?: string;
  totalOrders?: number;
  totalSpent?: number;
}

export type OrderTypeSel = "pickup" | "dine_in" | "delivery";
export type PosPaymentMethod = "cash" | "card";

export function lineKey(menuItemId: string, mods: SelectedModifier[]): string {
  return `${menuItemId}::${mods
    .map((m) => m.optionId)
    .sort()
    .join(",")}`;
}

export function lineTotal(line: CartLine): number {
  const modTotal = line.selectedModifiers.reduce((s, m) => s + m.priceAdjustment, 0);
  return (line.unitPrice + modTotal) * line.quantity;
}
