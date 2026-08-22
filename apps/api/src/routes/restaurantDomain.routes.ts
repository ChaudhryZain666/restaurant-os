import { Router } from "express";
import { addDomainSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  activateDomain,
  addDomain,
  checkDomainVerificationStatus,
  deactivateDomain,
  removeDomain,
} from "../controllers/domain.controller.js";

/**
 * Mounted at /restaurants/:restaurantId/domains. Reuses restaurant.settings.manage — the same
 * owner-only permission that already gates branding/currency/hours in SettingsPage.tsx — rather
 * than inventing a new permission; managing which domain fronts a location's storefront is the
 * same "who controls this storefront's identity" boundary. No RBAC entry added, none needed.
 */
export const restaurantDomainRouter = Router({ mergeParams: true });

restaurantDomainRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.settings.manage"));
restaurantDomainRouter.post("/", validateBody(addDomainSchema), asyncHandler(addDomain));
restaurantDomainRouter.post("/:id/check-verification", asyncHandler(checkDomainVerificationStatus));
restaurantDomainRouter.post("/:id/activate", asyncHandler(activateDomain));
restaurantDomainRouter.post("/:id/deactivate", asyncHandler(deactivateDomain));
restaurantDomainRouter.delete("/:id", asyncHandler(removeDomain));
