import { Router } from "express";
import { addDomainSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTenantMatch, requireTenantPermission as requirePermission } from "../middleware/tenant.js";
import { requireEntitlement } from "../services/entitlementLimit.service.js";
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
 *
 * Phase 27 — ONLY the creation route is entitlement-gated (custom_domains): an existing, already-
 * added domain keeps working (check-verification/activate/deactivate/remove all stay ungated) even
 * if a business's plan later changes, so an entitlement lapse can never silently break a live
 * storefront's domain out from under it — only prevents adding a NEW one.
 */
export const restaurantDomainRouter = Router({ mergeParams: true });

restaurantDomainRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.settings.manage"));
restaurantDomainRouter.post("/", requireEntitlement("custom_domains", "restaurantId"), validateBody(addDomainSchema), asyncHandler(addDomain));
restaurantDomainRouter.post("/:id/check-verification", asyncHandler(checkDomainVerificationStatus));
restaurantDomainRouter.post("/:id/activate", asyncHandler(activateDomain));
restaurantDomainRouter.post("/:id/deactivate", asyncHandler(deactivateDomain));
restaurantDomainRouter.delete("/:id", asyncHandler(removeDomain));
