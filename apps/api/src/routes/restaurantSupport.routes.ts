import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { listRestaurantTickets } from "../controllers/support.controller.js";

/**
 * Read-only ticket visibility for the restaurant's own staff (owner/manager) — mounted at
 * /restaurants/:restaurantId/support/tickets. Replying/managing tickets stays with platform
 * support (see supportAdmin.routes.ts); this only lets an owner see their own support history
 * without needing support.tickets.internal_notes or support.tickets.write.
 */
export const restaurantSupportRouter = Router({ mergeParams: true });

restaurantSupportRouter.get(
  "/",
  requireAuth,
  requireTenantMatch(),
  requirePermission("support.tickets.read"),
  asyncHandler(listRestaurantTickets)
);
