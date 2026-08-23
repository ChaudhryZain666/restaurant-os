import { Router } from "express";
import { businessPromotionSchema, updateBusinessPromotionSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireBusinessMatch } from "../middleware/businessLocation.js";
import { validateBody } from "../middleware/validate.js";
import {
  createBusinessPromotion,
  deleteBusinessPromotion,
  listBusinessPromotions,
  updateBusinessPromotion,
} from "../controllers/businessPromotion.controller.js";

/** Mounted at /businesses/:businessId/promotions — reuses restaurant.promotions.manage (already
 *  owner+manager only), the same permission that already gates location-promotion CRUD. */
export const businessPromotionRouter = Router({ mergeParams: true });

businessPromotionRouter.use(requireAuth, requireBusinessMatch(), requirePermission("restaurant.promotions.manage"));
businessPromotionRouter.get("/", asyncHandler(listBusinessPromotions));
businessPromotionRouter.post("/", validateBody(businessPromotionSchema), asyncHandler(createBusinessPromotion));
businessPromotionRouter.patch("/:id", validateBody(updateBusinessPromotionSchema), asyncHandler(updateBusinessPromotion));
businessPromotionRouter.delete("/:id", asyncHandler(deleteBusinessPromotion));
