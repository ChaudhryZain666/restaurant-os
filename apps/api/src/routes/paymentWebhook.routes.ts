import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { handleProviderWebhook, handleRestaurantAccountWebhook, handleStripeConnectWebhook } from "../controllers/paymentWebhook.controller.js";

/**
 * Mounted at /webhooks/payments/:provider — top-level, not under /restaurants: a webhook
 * delivery is authenticated by its signature (see paymentWebhook.controller.ts), not a user
 * session, and arrives with no relationship to any browser's cookies/auth headers at all. No
 * requireAuth, no tenant middleware — trusting an arbitrary caller here would be exactly the
 * "no trust in arbitrary client requests" failure this route exists to avoid, which is why
 * everything of substance happens after signature verification, not before it.
 */
export const paymentWebhookRouter = Router();

// Phase 37 — Stripe Connect's ONE centralized webhook endpoint, receiving events for every
// connected restaurant's account (distinguished by each event's own `account` field), so a
// restaurant never configures anything in their own Stripe dashboard. MUST be registered before
// the two routes below: "/stripe-connect" is a literal single-segment path that "/:provider"
// (also single-segment, registered next) would otherwise swallow first — unlike the two routes
// below, which genuinely don't collide with each other (different segment counts), this one does
// collide unless it's registered first.
paymentWebhookRouter.post("/stripe-connect", asyncHandler(handleStripeConnectWebhook));

paymentWebhookRouter.post("/:provider", asyncHandler(handleProviderWebhook));
// Restaurant-owned payment accounts (BYOC — see restaurantProvider.ts): a shared per-provider-name
// secret can't verify a webhook signed with a specific restaurant's OWN secret, so a BYOC-connected
// restaurant points its provider dashboard's webhook config at THIS url instead of the one above,
// naming the account up front so the right decrypted secret can be looked up before anything in
// the payload is trusted. Route order matters: this MUST come after "/:provider" is registered, or
// nothing — Express matches routes in registration order but these paths don't actually collide
// (different segment counts), so this is purely a readability convention, not a correctness one.
paymentWebhookRouter.post("/:provider/:restaurantPaymentAccountId", asyncHandler(handleRestaurantAccountWebhook));
