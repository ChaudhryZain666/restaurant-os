import { z } from "zod";

// Marketplace order-ingestion (Uber Eats/DoorDash/foodpanda) connect/sync schemas. See
// docs/marketplace-integration-architecture.md. Unlike connectUberDirectAccountSchema
// (delivery.ts), no credential fields here — every provider's platform-level credentials live in
// env vars (see RestaurantMarketplaceIntegration.ts's header comment); a restaurant only ever
// supplies the id of ITS store on that provider.

export const connectMarketplaceIntegrationSchema = z.object({
  provider: z.enum(["uber_eats", "doordash", "foodpanda"]),
  externalStoreId: z.string().min(1).max(200),
});
export type ConnectMarketplaceIntegrationInput = z.infer<typeof connectMarketplaceIntegrationSchema>;

// Phase 78 — the restaurant-facing OAuth connect flow's own two request shapes. `code`/`error` are
// mutually exclusive in practice (a provider sends one or the other) but both stay optional here —
// the controller itself decides what an absent code means, not this schema.
export const completeMarketplaceOAuthConnectSchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1),
  error: z.string().optional(),
});
export type CompleteMarketplaceOAuthConnectInput = z.infer<typeof completeMarketplaceOAuthConnectSchema>;

export const selectMarketplaceOAuthStoreSchema = z.object({
  stateId: z.string().min(1),
  externalStoreId: z.string().min(1).max(200),
});
export type SelectMarketplaceOAuthStoreInput = z.infer<typeof selectMarketplaceOAuthStoreSchema>;

// Phase 78 — Platform Admin's foodpanda-linking action (platform.controller.ts's
// linkFoodpandaIntegration). foodpanda has no restaurant-facing OAuth at all (client_credentials
// only, at the GarnishTable-partner level — see FoodpandaProvider.ts), so this is the real,
// permanent mechanism for activating a foodpanda connection, not a placeholder.
export const linkFoodpandaIntegrationSchema = z.object({
  externalStoreId: z.string().min(1).max(200),
});
export type LinkFoodpandaIntegrationInput = z.infer<typeof linkFoodpandaIntegrationSchema>;
