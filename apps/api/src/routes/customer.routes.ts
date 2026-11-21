import { Router } from "express";
import { listCustomerOrdersQuerySchema, listRestaurantCustomersQuerySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateQuery } from "../middleware/validate.js";
import { listCustomerOrders, listRestaurantCustomers } from "../controllers/customer.controller.js";

/** Mounted at /restaurants/:restaurantId/customers — mergeParams for :restaurantId. Gated on
 *  restaurant.customers.read: the directory (contact details, spend, history) is for owners,
 *  managers and front-of-house staff (the POS customer picker). Kitchen staff, who only prepare
 *  orders, can't list it; the customer details on each order still come with the order. */
export const customerRouter = Router({ mergeParams: true });

customerRouter.get(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.customers.read"),
  validateQuery(listRestaurantCustomersQuerySchema),
  asyncHandler(listRestaurantCustomers)
);

customerRouter.get(
  "/:customerId/orders",
  requireAuth,
  requireTenantMatch(),
  requirePermission("restaurant.customers.read"),
  validateQuery(listCustomerOrdersQuerySchema),
  asyncHandler(listCustomerOrders)
);
