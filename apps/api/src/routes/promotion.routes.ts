import { Router } from "express";
import rateLimit from "express-rate-limit";
import { promotionSchema, updatePromotionSchema, validatePromoSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission } from "../middleware/rbac.js";
import { requireTenantMatch } from "../middleware/tenant.js";
import { validateBody } from "../middleware/validate.js";
import { jsonRateLimitHandler } from "../middleware/rateLimitHandler.js";
import {
  checkPromoCode,
  createPromotion,
  deletePromotion,
  listPromotions,
  updatePromotion,
} from "../controllers/promotion.controller.js";

/** Mounted at /restaurants/:restaurantId/promotions — mergeParams is required to see :restaurantId. */
export const promotionRouter = Router({ mergeParams: true });

// Anyone with a cart can check a code against this restaurant, signed in or not — the cart shows
// the discount before the customer is asked to sign in. Read-only: it never touches usage counts,
// nothing in it depends on who is asking (no per-customer limits exist), and the code is checked
// again server-side when the order is placed (which still requires a customer account). Rate
// limited because it is now reachable without an account: guessing codes stays slow.
const promoCheckLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonRateLimitHandler,
});
promotionRouter.post("/check", promoCheckLimiter, validateBody(validatePromoSchema), asyncHandler(checkPromoCode));

promotionRouter.use(requireAuth, requireTenantMatch(), requirePermission("restaurant.promotions.manage"));
promotionRouter.get("/", asyncHandler(listPromotions));
promotionRouter.post("/", validateBody(promotionSchema), asyncHandler(createPromotion));
promotionRouter.patch("/:id", validateBody(updatePromotionSchema), asyncHandler(updatePromotion));
promotionRouter.delete("/:id", asyncHandler(deletePromotion));
