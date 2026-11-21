import type { ModifierGroup, SelectedModifier } from "@restaurant/types";

/** The options chosen in an item's modifier form, as the cart stores them. Unknown option ids
 *  (a stale selection after the menu changed) are dropped rather than priced. */
export function selectionsToModifiers(groups: ModifierGroup[], selections: Record<string, string[]>): SelectedModifier[] {
  return groups.flatMap((group) =>
    (selections[group.id] ?? []).flatMap((optionId) => {
      const option = group.options.find((o) => o.id === optionId);
      return option
        ? [{ groupId: group.id, groupName: group.name, optionId: option.id, optionName: option.name, priceAdjustment: option.priceAdjustment }]
        : [];
    })
  );
}

/** One line's price: base price plus every selected option's adjustment, times quantity. The one
 *  rule both the item dialog's "Add to order — $X" and the cart subtotal use, so they can't disagree
 *  (QA-002). The server re-prices every order from its own menu data regardless. */
export function linePrice(basePrice: number, modifiers: Pick<SelectedModifier, "priceAdjustment">[], quantity = 1): number {
  const optionsTotal = modifiers.reduce((sum, m) => sum + m.priceAdjustment, 0);
  return (basePrice + optionsTotal) * quantity;
}
