export interface ModifierOption {
  id: string;
  name: string;
  /** Added to the item's unit price when selected. Can be 0 but never negative. */
  priceAdjustment: number;
  isActive: boolean;
  sortOrder: number;
}

export interface ModifierGroup {
  id: string;
  restaurantId: string;
  menuItemId: string;
  name: string;
  /** Minimum number of options a customer must select from this group. */
  minSelect: number;
  /** Maximum number of options a customer may select from this group. */
  maxSelect: number;
  isActive: boolean;
  sortOrder: number;
  options: ModifierOption[];
}

/** A customer's chosen option within one modifier group, snapshotted onto an order line. */
export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}
