import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { listPlans } from "../controllers/plan.controller.js";

export const planRouter = Router();

planRouter.use(requireAuth);
planRouter.get("/", asyncHandler(listPlans));
