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
export async function listPlans(req: Request, res: Response) {
  // Lane A — private (negotiated) plans are platform-admin-assigned only; listing them to every
  // signed-in user would show one client's price to all. A subscriber on one still sees their own
  // plan via GET .../subscription, which returns it alongside the subscription.
  const filter = req.user?.role === "platform_admin" ? { isActive: true } : { isActive: true, isPubliclyListed: { $ne: false } };
  const plans = await Plan.find(filter).sort({ code: 1 });
  sendSuccess(res, { plans: plans.map((p) => p.toJSON()) });
}
