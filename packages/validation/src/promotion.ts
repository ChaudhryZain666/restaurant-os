import { z } from "zod";

const promotionBaseSchema = z.object({
  code: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, "Code can only contain letters, numbers, - and _")
    .transform((v) => v.toUpperCase()),
  name: z.string().min(2).max(80),
  type: z.enum(["percentage", "fixed"]),
  value: z.number().positive(),
  minOrderAmount: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  usageLimit: z.number().int().positive().optional(),
});

const PERCENTAGE_ISSUE = { message: "A percentage discount cannot exceed 100", path: ["value"] };

export const promotionSchema = promotionBaseSchema.refine(
  (v) => v.type !== "percentage" || v.value <= 100,
  PERCENTAGE_ISSUE
);
export type PromotionInput = z.infer<typeof promotionSchema>;

export const updatePromotionSchema = promotionBaseSchema.partial().refine((v) => {
  if (v.type !== "percentage" || v.value === undefined) return true;
  return v.value <= 100;
}, PERCENTAGE_ISSUE);
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;

export const validatePromoSchema = z.object({
  code: z.string().min(1).max(20),
  subtotal: z.number().nonnegative(),
});
export type ValidatePromoInput = z.infer<typeof validatePromoSchema>;

// Phase 23 — business-wide promotions. Same base fields as a location promotion, plus the
// selected-locations list (the reason a business promotion exists at all — see
// docs/multi-tenant-storefront-architecture.md's Phase 23 section for the scope model).
const locationIdsField = z.array(z.string().min(1)).min(1, "Select at least one location");

export const businessPromotionSchema = promotionBaseSchema
  .extend({ locationIds: locationIdsField })
  .refine((v) => v.type !== "percentage" || v.value <= 100, PERCENTAGE_ISSUE);
export type BusinessPromotionInput = z.infer<typeof businessPromotionSchema>;

export const updateBusinessPromotionSchema = promotionBaseSchema
  .extend({ locationIds: locationIdsField })
  .partial()
  .refine((v) => {
    if (v.type !== "percentage" || v.value === undefined) return true;
    return v.value <= 100;
  }, PERCENTAGE_ISSUE);
export type UpdateBusinessPromotionInput = z.infer<typeof updateBusinessPromotionSchema>;
