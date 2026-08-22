import { Router } from "express";
import { listCustomerOrdersQuerySchema, listRestaurantCustomersQuerySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateQuery } from "../middleware/validate.js";
import { listCustomerOrders, listRestaurantCustomers } from "../controllers/customer.controller.js";

/** Mounted at /restaurants/:restaurantId/customers — mergeParams for :restaurantId. Gated on
 *  restaurant.orders.read (not a new permission): this view is derived entirely from order data,
 *  visible to exactly the same roles who could already see the underlying orders. */
export const customerRouter = Router({ mergeParams: true });

customerRouter.get(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.orders.read"),
  validateQuery(listRestaurantCustomersQuerySchema),
  asyncHandler(listRestaurantCustomers)
);

customerRouter.get(
  "/:customerId/orders",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.orders.read"),
  validateQuery(listCustomerOrdersQuerySchema),
  asyncHandler(listCustomerOrders)
);
