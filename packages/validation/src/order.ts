import { z } from "zod";

export const createOrderSchema = z.object({
  items: z
    .array(z.object({ menuItemId: z.string(), quantity: z.number().int().positive() }))
    .min(1),
  redeemPoints: z.number().int().nonnegative().default(0),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z.object({
  status: z.enum(["pending", "confirmed", "preparing", "out_for_delivery", "delivered", "cancelled"]),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
