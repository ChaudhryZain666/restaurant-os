import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { getMyLoyaltyAccount, getMyLoyaltyHistory } from "../controllers/loyalty.controller.js";

export const loyaltyRouter = Router();

loyaltyRouter.use(requireAuth);
loyaltyRouter.get("/me", asyncHandler(getMyLoyaltyAccount));
loyaltyRouter.get("/me/history", asyncHandler(getMyLoyaltyHistory));
