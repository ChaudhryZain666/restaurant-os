import { Router } from "express";
import { connectMarketplaceIntegrationSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  connectMarketplaceIntegration,
  disconnectMarketplaceIntegration,
  listRestaurantMarketplaceIntegrations,
  startProviderOAuthConnect,
  triggerMarketplaceMenuSync,
} from "../controllers/restaurantMarketplaceIntegration.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/marketplace-integrations. Uses the new
 * `restaurant.marketplace.*` permissions (read for listing, manage for connect/disconnect/sync) —
 * NOT `restaurant.payments.manage` the way restaurantDeliveryProviderAccount.routes.ts deliberately
 * reuses it. See packages/types/src/types/agencyRbac.ts's doc comment for exactly why marketplace
 * integrations are tiered differently from payment/courier BYOC credentials (never hold a
 * restaurant's own payment/courier secret — see RestaurantMarketplaceIntegration.ts).
 * requireTenantPermission (not requirePermission) so an agency member acting on a managed business
 * via AGENCY_ROLE_GRANTS is checked too, exactly like every other location-scoped business route.
 */
export const restaurantMarketplaceIntegrationRouter = Router({ mergeParams: true });

restaurantMarketplaceIntegrationRouter.use(requireAuth, requireTenantMatch());
restaurantMarketplaceIntegrationRouter.get("/", requireTenantPermission("restaurant.marketplace.read"), asyncHandler(listRestaurantMarketplaceIntegrations));
restaurantMarketplaceIntegrationRouter.post(
  "/",
  requireTenantPermission("restaurant.marketplace.manage"),
  validateBody(connectMarketplaceIntegrationSchema),
  asyncHandler(connectMarketplaceIntegration)
);
restaurantMarketplaceIntegrationRouter.post(
  "/:provider/connect/start",
  requireTenantPermission("restaurant.marketplace.manage"),
  asyncHandler(startProviderOAuthConnect)
);
restaurantMarketplaceIntegrationRouter.post(
  "/:provider/disconnect",
  requireTenantPermission("restaurant.marketplace.manage"),
  asyncHandler(disconnectMarketplaceIntegration)
);
restaurantMarketplaceIntegrationRouter.post(
  "/:provider/sync",
  requireTenantPermission("restaurant.marketplace.manage"),
  asyncHandler(triggerMarketplaceMenuSync)
);
