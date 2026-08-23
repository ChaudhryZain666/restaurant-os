import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission } from "../middleware/businessLocation.js";
import { listDomainsForBusiness } from "../controllers/domain.controller.js";

/** Mounted at /businesses/:businessId/domains — read-only list across every location's domains. */
export const businessDomainRouter = Router({ mergeParams: true });

businessDomainRouter.get(
  "/",
  requireAuth,
  requireBusinessMatch(),
  requireBusinessPermission("restaurant.settings.manage"),
  asyncHandler(listDomainsForBusiness)
);
