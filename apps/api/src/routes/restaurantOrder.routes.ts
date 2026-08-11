import { Router } from "express";
import { createOrderSchema, updateOrderPaymentStatusSchema, updateOrderStatusSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  createOrder,
  listRestaurantOrders,
  updateOrderPaymentStatus,
  updateOrderStatus,
} from "../controllers/order.controller.js";

/** Mounted at /restaurants/:restaurantId/orders — mergeParams is required to see :restaurantId. */
export const restaurantOrderRouter = Router({ mergeParams: true });

restaurantOrderRouter.post("/", requireAuth, validateBody(createOrderSchema), asyncHandler(createOrder));
restaurantOrderRouter.get(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.orders.read"),
  asyncHandler(listRestaurantOrders)
);
restaurantOrderRouter.patch(
  "/:id/status",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.orders.manage"),
  validateBody(updateOrderStatusSchema),
  asyncHandler(updateOrderStatus)
);
restaurantOrderRouter.patch(
  "/:id/payment-status",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.orders.manage"),
  validateBody(updateOrderPaymentStatusSchema),
  asyncHandler(updateOrderPaymentStatus)
);
