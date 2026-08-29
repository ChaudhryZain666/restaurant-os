import { z } from "zod";

// BYOC (restaurant-owned payment accounts). Phase 37 — manual pasted-in credentials are now
// Safepay-ONLY: Safepay's current official docs confirm no marketplace/OAuth/sub-merchant/central-
// webhook capability exists for them, so encrypted merchant credentials genuinely remain the only
// option there. Stripe is connected exclusively through the real Connect/Account-Links onboarding
// flow (see restaurantPaymentAccount.controller.ts's connectStripeConnect) — a restaurant's own
// Stripe secret key is never collected through this schema, or anywhere else, again. "mock" is
// deliberately excluded — nothing real to protect, and it would never be BYOC-eligible anyway (see
// RestaurantPaymentAccount.ts's schema-level provider enum, which this must stay in sync with).

export const connectRestaurantPaymentAccountSchema = z.object({
  provider: z.literal("safepay"),
  credentials: z.object({
    apiKey: z.string().min(1, "API key is required"),
    secretKey: z.string().min(1, "Secret key is required"),
    webhookSecret: z.string().min(1, "Webhook secret is required"),
    env: z.enum(["sandbox", "production"]).default("sandbox"),
  }),
});
export type ConnectRestaurantPaymentAccountInput = z.infer<typeof connectRestaurantPaymentAccountSchema>;
