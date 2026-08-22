import { Router } from "express";
import { listMyOrdersQuerySchema } from "@restaurant/validation";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validate.js";
import { cancelMyOrder, getOrder, listMyOrders, reorderOrder } from "../controllers/order.controller.js";

/** Cross-restaurant, customer-owned order history — mounted at top-level /orders. */
export const orderRouter = Router();

orderRouter.use(requireAuth);
orderRouter.get("/mine", validateQuery(listMyOrdersQuerySchema), asyncHandler(listMyOrders));
orderRouter.get("/:id", asyncHandler(getOrder));
orderRouter.patch("/:id/cancel", asyncHandler(cancelMyOrder));
orderRouter.post("/:id/reorder", asyncHandler(reorderOrder));
