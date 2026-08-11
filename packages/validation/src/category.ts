import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  sortOrder: z.number().int().nonnegative().default(0),
  isActive: z.boolean().optional(),
});
export type CategoryInput = z.infer<typeof categorySchema>;

export const updateCategorySchema = categorySchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
