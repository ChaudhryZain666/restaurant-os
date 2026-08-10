import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validateBody } from "../middleware/validate.js";
import {
  createMenuItem,
  deleteMenuItem,
  listMenu,
  menuItemSchema,
  updateMenuItem,
} from "../controllers/menu.controller.js";

export const menuRouter = Router();

menuRouter.get("/", asyncHandler(listMenu));
menuRouter.post(
  "/",
  requireAuth,
  requireRole("admin", "staff"),
  validateBody(menuItemSchema),
  asyncHandler(createMenuItem)
);
menuRouter.patch("/:id", requireAuth, requireRole("admin", "staff"), asyncHandler(updateMenuItem));
menuRouter.delete("/:id", requireAuth, requireRole("admin", "staff"), asyncHandler(deleteMenuItem));
