import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createOrder,
  createOrderSchema,
  getOrder,
  listMyOrders,
  updateOrderStatus,
} from "../controllers/order.controller.js";

export const orderRouter = Router();

orderRouter.use(requireAuth);
orderRouter.post("/", validateBody(createOrderSchema), asyncHandler(createOrder));
orderRouter.get("/mine", asyncHandler(listMyOrders));
orderRouter.get("/:id", asyncHandler(getOrder));
orderRouter.patch("/:id/status", requireRole("staff", "admin"), asyncHandler(updateOrderStatus));
