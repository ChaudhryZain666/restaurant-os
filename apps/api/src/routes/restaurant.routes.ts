import { Router } from "express";
import { createRestaurantSchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { createRestaurant, getMyRestaurant, getRestaurantBySlug } from "../controllers/restaurant.controller.js";

export const restaurantRouter = Router();

restaurantRouter.post(
  "/",
  requireAuth,
  requireRole("platform_admin"),
  validateBody(createRestaurantSchema),
  asyncHandler(createRestaurant)
);
restaurantRouter.get("/me", requireAuth, asyncHandler(getMyRestaurant));
restaurantRouter.get("/by-slug/:slug", asyncHandler(getRestaurantBySlug));
