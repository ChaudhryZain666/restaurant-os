import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { getOrder, listMyOrders } from "../controllers/order.controller.js";

/** Cross-restaurant, customer-owned order history — mounted at top-level /orders. */
export const orderRouter = Router();

orderRouter.use(requireAuth);
orderRouter.get("/mine", asyncHandler(listMyOrders));
orderRouter.get("/:id", asyncHandler(getOrder));
