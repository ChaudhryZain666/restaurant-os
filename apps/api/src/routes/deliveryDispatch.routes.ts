import { Router } from "express";
import { cancelDeliverySchema, updateManualDeliverySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { requirePermission } from "../middleware/rbac.js";
import { validateBody } from "../middleware/validate.js";
import {
  cancelOrderDelivery,
  getDeliveryForOrder,
  retryOrderDeliveryCreation,
  updateManualDeliveryStatus,
} from "../controllers/deliveryDispatch.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/orders/:orderId/delivery — staff-facing courier-dispatch
 * status/actions for one order, reusing `restaurant.orders.manage` (the same permission every other
 * staff order action already gates on — kitchen/front-of-house level, not owner-only) rather than
 * inventing a new one. Distinct from delivery.routes.ts (the customer-facing eligibility/fee
 * "/check" preview, unrelated and unchanged by this phase) and from
 * restaurantDeliveryProviderAccount.routes.ts (owner-only provider connection, a separate concern).
 */
export const deliveryDispatchRouter = Router({ mergeParams: true });

deliveryDispatchRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.orders.manage"));
deliveryDispatchRouter.get("/", asyncHandler(getDeliveryForOrder));
deliveryDispatchRouter.post("/manual-status", validateBody(updateManualDeliverySchema), asyncHandler(updateManualDeliveryStatus));
deliveryDispatchRouter.post("/cancel", validateBody(cancelDeliverySchema), asyncHandler(cancelOrderDelivery));
deliveryDispatchRouter.post("/retry", asyncHandler(retryOrderDeliveryCreation));
