import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listPublicPlans } from "../controllers/publicPlan.controller.js";

/** Mounted at /public/plans — genuinely unauthenticated, unlike plan.routes.ts's /plans. See
 *  publicPlan.controller.ts's doc comment for exactly what's stripped and why. */
export const publicPlanRouter = Router();

publicPlanRouter.get("/", asyncHandler(listPublicPlans));
