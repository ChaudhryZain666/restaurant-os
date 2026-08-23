import { Router } from "express";
import { businessPromotionSchema, updateBusinessPromotionSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireBusinessMatch, requireBusinessPermission as requirePermission } from "../middleware/businessLocation.js";
import { requireEntitlement } from "../services/entitlementLimit.service.js";
import { validateBody } from "../middleware/validate.js";
import {
  createBusinessPromotion,
  deleteBusinessPromotion,
  listBusinessPromotions,
  updateBusinessPromotion,
} from "../controllers/businessPromotion.controller.js";

/** Mounted at /businesses/:businessId/promotions — reuses restaurant.promotions.manage (already
 *  owner+manager only), the same permission that already gates location-promotion CRUD. Phase 27 —
 *  also gated on the business_promotions plan entitlement. */
export const businessPromotionRouter = Router({ mergeParams: true });

businessPromotionRouter.use(
  requireAuth,
  requireBusinessMatch(),
  requirePermission("restaurant.promotions.manage"),
  requireEntitlement("business_promotions")
);
businessPromotionRouter.get("/", asyncHandler(listBusinessPromotions));
businessPromotionRouter.post("/", validateBody(businessPromotionSchema), asyncHandler(createBusinessPromotion));
businessPromotionRouter.patch("/:id", validateBody(updateBusinessPromotionSchema), asyncHandler(updateBusinessPromotion));
businessPromotionRouter.delete("/:id", asyncHandler(deleteBusinessPromotion));
