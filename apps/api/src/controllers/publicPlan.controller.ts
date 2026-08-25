import type { Request, Response } from "express";
import { Plan } from "../models/Plan.js";
import { sendSuccess } from "../common/response.js";
import { resolveTrialDays } from "../services/subscription.service.js";

/**
 * GET /public/plans — Phase 28, deliberately separate from plan.controller.ts's listPlans (which
 * stays requireAuth-gated, unchanged, and returns the full document including provider ids). The
 * marketing site (apps/marketing) needs real pricing before anyone has an account, so this exists
 * as a genuinely public, unauthenticated read of the SAME Plan catalog — never a second, duplicated
 * pricing source — stripped to only what a pricing page needs (no providerPriceId/providerProductId
 * plumbing, no free-form metadata that was never meant to be public-facing).
 */
export async function listPublicPlans(_req: Request, res: Response) {
  const plans = await Plan.find({ isActive: true }).sort({ code: 1 });
  sendSuccess(res, {
    plans: plans.map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type,
      description: p.description,
      pricing: p.pricing.map((price) => ({ interval: price.interval, amountCents: price.amountCents, currency: price.currency })),
      entitlements: p.entitlements,
      // Effective trial length (the plan's own override, or the platform default) — same logic
      // subscription.service.ts's createSubscriptionCore actually uses, so this page never shows a
      // trial length that doesn't match what actually happens when the trial starts.
      trialDays: resolveTrialDays(p),
    })),
  });
}
