import { z } from "zod";
import { createBusinessSelfServeSchema } from "./businessSelfServe.js";

/** Launch, 2026-11-21 — the public pay-now checkout (garnishtable.com/checkout): no account, no trial. */
export const startGuestCheckoutSchema = z.object({
  planCode: z.string().min(1).max(80),
  billingInterval: z.enum(["monthly", "yearly"]),
});
export type StartGuestCheckoutInput = z.infer<typeof startGuestCheckoutSchema>;

/** One-time set-up token: from the checkout page's browser, or from the emailed link. */
export const guestCheckoutTokenSchema = z.string().min(20).max(200);

export const guestCheckoutStatusQuerySchema = z.object({ token: guestCheckoutTokenSchema });

/** Set up a NEW account for a paid purchase. The email is the one the customer gave at checkout. */
export const claimGuestCheckoutSchema = z.object({
  token: guestCheckoutTokenSchema,
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: "You must accept the Terms of Service and Privacy Policy to continue." }) }),
  restaurant: createBusinessSelfServeSchema,
});
export type ClaimGuestCheckoutInput = z.infer<typeof claimGuestCheckoutSchema>;

/** Attach a paid purchase to the signed-in account (its email already had an account). The
 *  restaurant is only needed when that account has none yet. */
export const claimGuestCheckoutForUserSchema = z.object({
  token: guestCheckoutTokenSchema,
  restaurant: createBusinessSelfServeSchema.optional(),
  termsAccepted: z.literal(true).optional(),
});
export type ClaimGuestCheckoutForUserInput = z.infer<typeof claimGuestCheckoutForUserSchema>;
