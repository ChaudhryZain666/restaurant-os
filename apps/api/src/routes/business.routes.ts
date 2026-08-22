import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireLocationAccess } from "../middleware/businessLocation.js";
import { getMyBusiness, listBusinessLocations, getBusinessLocation } from "../controllers/business.controller.js";

/** Mounted at /businesses — a new, net-new namespace (Phase 18). Deliberately does not replace or
 *  modify any /restaurants/:restaurantId/... route. */
export const businessRouter = Router();

businessRouter.use(requireAuth);

businessRouter.get("/me", asyncHandler(getMyBusiness));
businessRouter.get("/:businessId/locations", requireBusinessMatch(), asyncHandler(listBusinessLocations));
businessRouter.get(
  "/:businessId/locations/:locationId",
  requireLocationAccess(),
  asyncHandler(getBusinessLocation)
);
