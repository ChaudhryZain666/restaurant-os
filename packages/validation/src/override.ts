import { z } from "zod";

// Phase 21 — every field here is optional at the model level (a sparse override row only exists
// for the fields a location actually diverges on), but a PUT with every field omitted would just
// create a pointless empty row — rejected explicitly rather than silently accepted.

export const categoryOverrideSchema = z
  .object({
    isActive: z.boolean().optional(),
    sortOrderOverride: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.isActive !== undefined || v.sortOrderOverride !== undefined, {
    message: "At least one field must be provided to override",
  });
export type CategoryOverrideInput = z.infer<typeof categoryOverrideSchema>;

export const menuItemOverrideSchema = z
  .object({
    isAvailable: z.boolean().optional(),
    priceOverride: z.number().nonnegative().optional(),
    sortOrderOverride: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.isAvailable !== undefined || v.priceOverride !== undefined || v.sortOrderOverride !== undefined, {
    message: "At least one field must be provided to override",
  });
export type MenuItemOverrideInput = z.infer<typeof menuItemOverrideSchema>;

const modifierOptionOverrideSchema = z
  .object({
    optionId: z.string().min(1),
    isActive: z.boolean().optional(),
    priceAdjustmentOverride: z.number().nonnegative().optional(),
  })
  .refine((v) => v.isActive !== undefined || v.priceAdjustmentOverride !== undefined, {
    message: "Each option override must set isActive and/or priceAdjustmentOverride",
  });

export const modifierGroupOverrideSchema = z
  .object({
    isActive: z.boolean().optional(),
    optionOverrides: z.array(modifierOptionOverrideSchema).optional(),
  })
  .refine((v) => v.isActive !== undefined || (v.optionOverrides?.length ?? 0) > 0, {
    message: "At least one field must be provided to override",
  });
export type ModifierGroupOverrideInput = z.infer<typeof modifierGroupOverrideSchema>;
