import { z } from "zod";

export const modifierOptionSchema = z.object({
  name: z.string().min(1).max(80),
  priceAdjustment: z.number().nonnegative(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
});
export type ModifierOptionInput = z.infer<typeof modifierOptionSchema>;

// menuItemId is deliberately not a field here — the route is nested under
// /restaurants/:restaurantId/menu/:menuItemId/modifiers, so it always comes from the URL
// (already tenant-verified), the same way restaurantId does for every other resource.
const modifierGroupBaseSchema = z.object({
  name: z.string().min(1).max(80),
  minSelect: z.number().int().nonnegative().default(0),
  maxSelect: z.number().int().positive().default(1),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().default(0),
  options: z.array(modifierOptionSchema).min(1),
});

// A group with minSelect > maxSelect (e.g. "requires 3, allows at most 1") can never be
// satisfied — priceOrderItems would reject every possible selection count, making any menu
// item that carries this group permanently unorderable. Caught here, at the source, rather
// than as an inexplicable 400 on every order attempt later.
const MIN_MAX_SELECT_ISSUE = {
  message: "minSelect cannot be greater than maxSelect",
  path: ["minSelect"],
};

export const modifierGroupSchema = modifierGroupBaseSchema.refine(
  (v) => v.minSelect <= v.maxSelect,
  MIN_MAX_SELECT_ISSUE
);
export type ModifierGroupInput = z.infer<typeof modifierGroupSchema>;

export const updateModifierGroupSchema = modifierGroupBaseSchema.partial().refine((v) => {
  if (v.minSelect === undefined || v.maxSelect === undefined) return true;
  return v.minSelect <= v.maxSelect;
}, MIN_MAX_SELECT_ISSUE);
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;
