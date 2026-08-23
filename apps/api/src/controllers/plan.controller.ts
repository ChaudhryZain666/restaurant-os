import type { Request, Response } from "express";
import { Plan } from "../models/Plan.js";
import { sendSuccess } from "../common/response.js";

/**
 * GET /plans — the read-only catalog an owner picks from when starting a subscription. Not
 * restaurant/business-scoped data (same reasoning as geocoding.routes.ts's requireAuth-only
 * gating): any authenticated staff member can see what plans exist, same as they could see a
 * pricing page on a real marketing site. No pricing amounts are guaranteed to be present (see
 * packages/types/src/types/plan.ts) — this returns exactly what's in the catalog, nothing invented.
 */
export async function listPlans(_req: Request, res: Response) {
  const plans = await Plan.find({ isActive: true }).sort({ code: 1 });
  sendSuccess(res, { plans: plans.map((p) => p.toJSON()) });
}
