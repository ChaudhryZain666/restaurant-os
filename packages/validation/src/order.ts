import { z } from "zod";
import { paginationQueryShape } from "./pagination.js";

// Client submits only which options it picked — never a price or name. The server looks up
// the authoritative priceAdjustment/name from the ModifierGroup/Option documents at order time.
const selectedModifierInputSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});

// Coordinates are required (not optional like a saved Address's) — a delivery order can't be
// distance-validated without them, and createOrder rejects a delivery order that omits them. See
// docs/delivery-architecture.md. The client may supply a fee/distance-shaped field here and it is
// simply ignored — nothing on this schema accepts one; createOrder computes both itself.
const deliveryAddressInputSchema = z.object({
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100),
  state: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  instructions: z.string().max(300).optional(),
});

export const createOrderSchema = z
  .object({
    items: z
      .array(
        z.object({
          menuItemId: z.string(),
          quantity: z.number().int().positive(),
          selectedModifiers: z.array(selectedModifierInputSchema).default([]),
          // Customer-visible ("no onions") — free text, never priced or validated against menu data.
          specialInstructions: z.string().max(300).optional(),
        })
      )
      .min(1),
    orderType: z.enum(["pickup", "delivery", "dine_in"]),
    // "cash" preserves this platform's original, still-fully-supported behavior: staff mark it
    // collected via updateOrderPaymentStatus. "online" routes the order through the Payment
    // domain (see services/payment.service.ts) instead — created here as unpaid either way, since
    // an order is never trusted to already be paid at creation regardless of method.
    paymentMethod: z.enum(["cash", "online"]).default("cash"),
    deliveryAddress: deliveryAddressInputSchema.optional(),
    // The QR token the customer's session resolved (see apps/web's TableContext) — only ever
    // used to RE-resolve the table server-side in createOrder; the client never supplies a
    // tableId directly, and this string alone grants no access beyond "which table is this."
    tableToken: z.string().max(64).optional(),
    customerNotes: z.string().max(1000).optional(),
    redeemPoints: z.number().int().nonnegative().default(0),
    // Re-validated server-side against the live Promotion document in createOrder — this string is
    // the only thing trusted from the client; the discount it produces is always computed fresh.
    promoCode: z.string().max(20).optional(),
  })
  .refine((v) => v.orderType !== "dine_in" || Boolean(v.tableToken), {
    message: "tableToken is required for dine-in orders",
    path: ["tableToken"],
  })
  .refine((v) => v.orderType !== "delivery" || Boolean(v.deliveryAddress), {
    message: "deliveryAddress is required for delivery orders",
    path: ["deliveryAddress"],
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

// Staff-only note, never customer-visible (see order.controller.ts's stripInternalFields).
// Empty string is a valid value — it's how staff clear a previously-set note.
export const updateOrderNoteSchema = z.object({
  internalNote: z.string().max(1000),
});
export type UpdateOrderNoteInput = z.infer<typeof updateOrderNoteSchema>;

// GET /orders/mine — no sort/filter beyond the existing fixed createdAt-descending order, just
// bounded page/limit (Phase 12's shared pagination convention).
export const listMyOrdersQuerySchema = z.object(paginationQueryShape);
export type ListMyOrdersQueryInput = z.infer<typeof listMyOrdersQuerySchema>;
