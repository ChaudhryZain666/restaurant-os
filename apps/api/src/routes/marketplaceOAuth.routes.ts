import { Router } from "express";
import { completeMarketplaceOAuthConnectSchema, selectMarketplaceOAuthStoreSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { completeUberEatsConnect, selectUberEatsStore } from "../controllers/marketplaceOAuth.controller.js";

/**
 * Mounted at /marketplace-oauth — deliberately NOT nested under /restaurants/:restaurantId, unlike
 * every other marketplace route. apps/admin has no tenant-scoped routing (every route is bare —
 * see LocationContext.tsx), and the browser landing back here from Uber's own consent screen carries
 * no Authorization header the way a normal API call does — so there is no `:restaurantId` to check
 * on the way in. `requireAuth` only: WHICH restaurant/business this connection belongs to is derived
 * entirely from the OAuth state document consumed inside the controller, never from a URL param or
 * the request body. Today this only serves Uber Eats (the one provider with a real merchant-facing
 * OAuth flow — see marketplaceProviders/uberEatsConnect.ts); a `:provider` segment is kept in the
 * path so a future OAuth-shaped provider (if DoorDash's SSIO technical details ever become
 * confirmable) has somewhere to land without a URL-shape migration.
 */
export const marketplaceOAuthRouter = Router();

marketplaceOAuthRouter.use(requireAuth);
marketplaceOAuthRouter.post(
  "/uber_eats/callback",
  validateBody(completeMarketplaceOAuthConnectSchema),
  asyncHandler(completeUberEatsConnect)
);
marketplaceOAuthRouter.post(
  "/uber_eats/select-store",
  validateBody(selectMarketplaceOAuthStoreSchema),
  asyncHandler(selectUberEatsStore)
);
