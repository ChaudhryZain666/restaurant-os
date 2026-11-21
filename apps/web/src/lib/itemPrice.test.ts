import { describe, expect, it } from "@jest/globals";
import type { ModifierGroup } from "@restaurant/types";
import { linePrice, selectionsToModifiers } from "./itemPrice";

const size: ModifierGroup = {
  id: "size",
  name: "Size",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "s", name: "Small", priceAdjustment: 0 },
    { id: "m", name: "Medium", priceAdjustment: 2 },
    { id: "l", name: "Large", priceAdjustment: 4 },
  ],
} as unknown as ModifierGroup;

const extras: ModifierGroup = {
  id: "extras",
  name: "Extras",
  minSelect: 0,
  maxSelect: 3,
  options: [
    { id: "truffle", name: "Truffle oil", priceAdjustment: 1.5 },
    { id: "egg", name: "Egg", priceAdjustment: 1 },
    { id: "basil", name: "Basil", priceAdjustment: 0 },
  ],
} as unknown as ModifierGroup;

// QA-002 — the item dialog showed the base price ($16.00) after "Medium (+$2.00)" was chosen while
// the cart charged $18.00. Both now price through linePrice.
describe("item pricing (QA-002)", () => {
  it("no options: the base price", () => {
    expect(linePrice(16, selectionsToModifiers([size, extras], {}))).toBe(16);
  });

  it("a single priced option is added once", () => {
    expect(linePrice(16, selectionsToModifiers([size], { size: ["m"] }))).toBe(18);
  });

  it("several optional add-ons, including a free one, add up", () => {
    const mods = selectionsToModifiers([size, extras], { size: ["l"], extras: ["truffle", "egg", "basil"] });
    expect(mods.map((m) => m.optionName)).toEqual(["Large", "Truffle oil", "Egg", "Basil"]);
    expect(linePrice(16, mods)).toBeCloseTo(22.5, 10);
  });

  it("quantity multiplies the whole line, options included — never double-counting them", () => {
    const mods = selectionsToModifiers([size, extras], { size: ["m"], extras: ["egg"] });
    expect(linePrice(16, mods, 1)).toBe(19);
    expect(linePrice(16, mods, 3)).toBe(57);
  });

  it("an option id that no longer exists is ignored, not priced or crashed on", () => {
    expect(selectionsToModifiers([size], { size: ["gone"] })).toEqual([]);
    expect(linePrice(16, selectionsToModifiers([size], { size: ["gone", "m"] }))).toBe(18);
  });

  it("the dialog price equals the cart line for the same choices", () => {
    const selections = { size: ["m"], extras: ["truffle"] };
    const dialog = linePrice(16, selectionsToModifiers([size, extras], selections));
    const cartLine = { menuItem: { price: 16 }, selectedModifiers: selectionsToModifiers([size, extras], selections), quantity: 2 };
    expect(linePrice(cartLine.menuItem.price, cartLine.selectedModifiers, cartLine.quantity)).toBe(dialog * 2);
  });
});
