import { Router } from "express";
import { changeSubscriptionPlanSchema, createSubscriptionSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAgencyMatch, requireAgencyPermission } from "../middleware/agency.js";
import { validateBody } from "../middleware/validate.js";
import {
  cancelAgencySubscriptionHandler,
  changeAgencyPlanHandler,
  createAgencySubscriptionHandler,
  getAgencyEntitlementsHandler,
  getAgencySubscriptionHandler,
  reactivateAgencySubscriptionHandler,
} from "../controllers/agencySubscription.controller.js";

/** Mounted at /agencies/:agencyId/subscription — mirrors businessSubscription.routes.ts exactly:
 *  agency.billing.read for the two GET routes, agency.billing.manage for everything that changes
 *  state. No subscription id in the URL — an agency has at most one live subscription (DB-enforced). */
export const agencySubscriptionRouter = Router({ mergeParams: true });

agencySubscriptionRouter.use(requireAuth, requireAgencyMatch());

agencySubscriptionRouter.get("/", requireAgencyPermission("agency.billing.read"), asyncHandler(getAgencySubscriptionHandler));
agencySubscriptionRouter.get(
  "/entitlements",
  requireAgencyPermission("agency.billing.read"),
  asyncHandler(getAgencyEntitlementsHandler)
);

agencySubscriptionRouter.post(
  "/",
  requireAgencyPermission("agency.billing.manage"),
  validateBody(createSubscriptionSchema),
  asyncHandler(createAgencySubscriptionHandler)
);
agencySubscriptionRouter.post(
  "/cancel",
  requireAgencyPermission("agency.billing.manage"),
  asyncHandler(cancelAgencySubscriptionHandler)
);
agencySubscriptionRouter.post(
  "/reactivate",
  requireAgencyPermission("agency.billing.manage"),
  asyncHandler(reactivateAgencySubscriptionHandler)
);
agencySubscriptionRouter.post(
  "/change-plan",
  requireAgencyPermission("agency.billing.manage"),
  validateBody(changeSubscriptionPlanSchema),
  asyncHandler(changeAgencyPlanHandler)
);
