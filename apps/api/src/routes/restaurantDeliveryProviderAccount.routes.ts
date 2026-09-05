import { Router } from "express";
import { connectUberDirectAccountSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  connectUberDirectAccount,
  disconnectRestaurantDeliveryProviderAccount,
  getRestaurantDeliveryProviderAccount,
} from "../controllers/restaurantDeliveryProviderAccount.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/delivery-account — deliberately reuses
 * `restaurant.payments.manage`, NOT `restaurant.settings.manage` (which also gates this route's
 * sibling, updateRestaurant's settings.deliveryProvider field-level choice — a plain "which
 * provider do we want" toggle, not a credential). A connected courier account holds the same class
 * of sensitive, real-money-adjacent third-party credential as a payment account, and
 * `restaurant.payments.manage` is the one permission already deliberately excluded from EVERY
 * agency role (see agencyRbac.ts's AGENCY_ROLE_GRANTS doc comment: "restaurant payment-provider
 * credentials stay owner-only") — reusing it here extends that exact same boundary to courier
 * credentials instead of accidentally granting an agency_owner/agency_admin access to a managed
 * business's own Uber Direct account. Still available to both restaurant_owner and
 * restaurant_manager within the restaurant's own staff hierarchy, matching the payment BYOC
 * precedent (restaurantPaymentAccount.routes.ts) exactly.
 */
export const restaurantDeliveryProviderAccountRouter = Router({ mergeParams: true });

restaurantDeliveryProviderAccountRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.payments.manage"));
restaurantDeliveryProviderAccountRouter.get("/", asyncHandler(getRestaurantDeliveryProviderAccount));
restaurantDeliveryProviderAccountRouter.post("/", validateBody(connectUberDirectAccountSchema), asyncHandler(connectUberDirectAccount));
restaurantDeliveryProviderAccountRouter.post("/disconnect", asyncHandler(disconnectRestaurantDeliveryProviderAccount));
