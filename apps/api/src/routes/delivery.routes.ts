import { Router } from "express";
import { checkDeliverySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import { checkDelivery } from "../controllers/delivery.controller.js";

/** Mounted at /restaurants/:restaurantId/delivery — mergeParams is required to see :restaurantId. */
export const deliveryRouter = Router({ mergeParams: true });

// Any authenticated customer can check a location against this restaurant — read-only, so it
// doesn't need any restaurant-management permission or tenant match (same reasoning as
// promotion.routes.ts's /check).
deliveryRouter.use(requireAuth);
deliveryRouter.post("/check", validateBody(checkDeliverySchema), asyncHandler(checkDelivery));
