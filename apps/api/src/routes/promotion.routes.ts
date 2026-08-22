import { Router } from "express";
import { promotionSchema, updatePromotionSchema, validatePromoSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import {
  checkPromoCode,
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
} from "../controllers/promotion.controller.js";

/** Mounted at /restaurants/:restaurantId/promotions — mergeParams is required to see :restaurantId. */
export const promotionRouter = Router({ mergeParams: true });

promotionRouter.use(requireAuth);

// Any authenticated customer can check a code against this restaurant — read-only, never
// mutates usage counts, so it doesn't need restaurant.promotions.manage or tenant match.
promotionRouter.post("/check", validateBody(validatePromoSchema), asyncHandler(checkPromoCode));

promotionRouter.use(requireTenantMatch(), requirePermission("restaurant.promotions.manage"));
promotionRouter.get("/", asyncHandler(listPromotions));
promotionRouter.post("/", validateBody(promotionSchema), asyncHandler(createPromotion));
promotionRouter.patch("/:id", validateBody(updatePromotionSchema), asyncHandler(updatePromotion));
promotionRouter.delete("/:id", asyncHandler(deletePromotion));
