import { z } from "zod";

// BYOC (restaurant-owned payment accounts) — the shape of a restaurant's own pasted-in provider
// credentials, validated here before they're ever encrypted. "mock" is deliberately excluded —
// nothing real to protect, and it would never be BYOC-eligible anyway (see
// RestaurantPaymentAccount.ts's schema-level provider enum, which this must stay in sync with).

const stripeCredentialsSchema = z.object({
  provider: z.literal("stripe"),
  credentials: z.object({
    secretKey: z.string().min(1, "Secret key is required"),
    webhookSecret: z.string().min(1, "Webhook secret is required"),
  }),
});

const safepayCredentialsSchema = z.object({
  provider: z.literal("safepay"),
  credentials: z.object({
    apiKey: z.string().min(1, "API key is required"),
    secretKey: z.string().min(1, "Secret key is required"),
    webhookSecret: z.string().min(1, "Webhook secret is required"),
    env: z.enum(["sandbox", "production"]).default("sandbox"),
  }),
});

export const connectRestaurantPaymentAccountSchema = z.discriminatedUnion("provider", [
  stripeCredentialsSchema,
  safepayCredentialsSchema,
]);
export type ConnectRestaurantPaymentAccountInput = z.infer<typeof connectRestaurantPaymentAccountSchema>;
