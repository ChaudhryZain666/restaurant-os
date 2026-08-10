import { z } from "zod";

export const menuItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  price: z.number().nonnegative(),
  category: z.string().min(1).max(60),
  imageUrl: z.string().url().optional(),
  isAvailable: z.boolean().optional(),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;
