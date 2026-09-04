import { z } from "zod";

const selectedModifierInputSchema = z.object({
  groupId: z.string().min(1),
  optionId: z.string().min(1),
});

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

// Either an existing customer the staff member searched for and picked, or enough to create a
// new, real (not demo) walk-in customer record on the spot — see
// apps/api/src/services/posCustomer.service.ts. At least a name is required for a new walk-in;
// phone/email are optional but at least one is recommended so the same person can be found again
// on a future visit (not enforced here — a restaurant ringing up a genuinely anonymous cash sale
// shouldn't be blocked over it).
export const posCustomerInputSchema = z.union([
  z.object({ customerId: z.string().min(1) }),
  z.object({
    name: z.string().min(1).max(120),
    phone: z.string().max(30).optional(),
    email: z.string().email().max(200).optional(),
  }),
]);
export type PosCustomerInput = z.infer<typeof posCustomerInputSchema>;

// Deliberately narrower than createOrderSchema's paymentMethod: no "online" here. Online payment
// is the customer's own checkout flow (a hosted/redirect payment session tied to their own
// session) — there's no sensible way for a staff terminal to trigger that on a customer's behalf,
// so POS only ever offers the two in-person, staff-collected methods. See Order.ts's paymentMethod
// comment for why "card" behaves identically to "cash" in this system.
export const createPosOrderSchema = z
  .object({
    customer: posCustomerInputSchema,
    items: z
      .array(
        z.object({
          menuItemId: z.string(),
          quantity: z.number().int().positive(),
          selectedModifiers: z.array(selectedModifierInputSchema).default([]),
          specialInstructions: z.string().max(300).optional(),
        })
      )
      .min(1),
    orderType: z.enum(["pickup", "delivery", "dine_in"]),
    paymentMethod: z.enum(["cash", "card"]).default("cash"),
    // Staff collects payment in the same motion as ringing up the sale — defaults to true (order
    // is created already paid) rather than requiring a second payment-status call, but stays
    // overridable for a restaurant that tabs a dine-in order and settles payment later.
    markPaidImmediately: z.boolean().default(true),
    deliveryAddress: deliveryAddressInputSchema.optional(),
    // Staff pick a table from the restaurant's own table list (already tenant-scoped, already
    // trusted) rather than scanning a QR — see orderCreation.service.ts's tableId branch.
    tableId: z.string().max(64).optional(),
    customerNotes: z.string().max(1000).optional(),
    redeemPoints: z.number().int().nonnegative().default(0),
    promoCode: z.string().max(20).optional(),
  })
  .refine((v) => v.orderType !== "dine_in" || Boolean(v.tableId), {
    message: "tableId is required for dine-in orders",
    path: ["tableId"],
  })
  .refine((v) => v.orderType !== "delivery" || Boolean(v.deliveryAddress), {
    message: "deliveryAddress is required for delivery orders",
    path: ["deliveryAddress"],
  });
export type CreatePosOrderInput = z.infer<typeof createPosOrderSchema>;
