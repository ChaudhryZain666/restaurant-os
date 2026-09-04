import { Router } from "express";
import { createPosOrderSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { createPosOrder } from "../controllers/pos.controller.js";

/** Mounted at /restaurants/:restaurantId/pos — mergeParams for :restaurantId. Every route here is
 *  staff-only (never public — unlike table resolution, there's no anonymous POS caller), gated on
 *  the new restaurant.pos.operate permission (owner/manager/staff, not kitchen_staff — see
 *  packages/types/src/types/rbac.ts). */
export const posRouter = Router({ mergeParams: true });

posRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.pos.operate"));

posRouter.post("/orders", validateBody(createPosOrderSchema), asyncHandler(createPosOrder));
