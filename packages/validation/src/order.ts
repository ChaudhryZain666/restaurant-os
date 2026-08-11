import { z } from "zod";

// Client submits only which options it picked — never a price or name. The server looks up
// the authoritative priceAdjustment/name from the ModifierGroup/Option documents at order time.
const selectedModifierInputSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});

export const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        quantity: z.number().int().positive(),
        selectedModifiers: z.array(selectedModifierInputSchema).default([]),
      })
    )
    .min(1),
  orderType: z.enum(["pickup", "delivery"]),
  deliveryAddress: z.string().max(300).optional(),
  customerNotes: z.string().max(1000).optional(),
  redeemPoints: z.number().int().nonnegative().default(0),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled",
] as const;

export const updateOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;

export const updateOrderPaymentStatusSchema = z.object({
  paymentStatus: z.enum(["unpaid", "paid"]),
});
export type UpdateOrderPaymentStatusInput = z.infer<typeof updateOrderPaymentStatusSchema>;
