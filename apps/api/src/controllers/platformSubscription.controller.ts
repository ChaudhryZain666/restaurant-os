import type { Request, Response } from "express";
import type { CreateSubscriptionInput } from "@restaurant/validation";
import type { PlatformPlanOption } from "@restaurant/types";
import { Plan } from "../models/Plan.js";
import { sendSuccess } from "../common/response.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { assignPlanToAgency, assignPlanToBusiness, resolveTrialDays } from "../services/subscription.service.js";
import { auditAcrossBusiness } from "./subscription.controller.js";

/**
 * Lane A — platform-admin plan assignment for a client (including a private, client-specific plan).
 *
 * This deliberately goes through the SAME lifecycle service an owner's own "Start trial" uses
 * (createSubscriptionCore, via assignPlanTo*): it starts a no-card trial on the chosen plan, records the
 * "trial_started" billing-history row, and refuses a second live subscription. It never inserts a
 * Subscription directly, never calls the billing provider, never charges anything, and never
 * changes an existing subscription — the owner converts the trial through the normal checkout.
 * A plan without a trial is refused by that same service (it needs a payment method up front).
 */
export async function listPlatformPlans(_req: Request, res: Response) {
  const plans = await Plan.find({ isActive: true }).sort({ type: 1, isPubliclyListed: -1, name: 1 });
  const items: PlatformPlanOption[] = plans.map((p) => {
    const trialDays = resolveTrialDays(p) ?? null;
    return {
      code: p.code,
      name: p.name,
      type: p.type,
      isPubliclyListed: p.isPubliclyListed !== false,
      trialDays,
      assignable: trialDays !== null,
      // Provider price ids are an external system's internal reference — only whether one exists.
      pricing: p.pricing.map((pr) => ({
        interval: pr.interval,
        amountCents: pr.amountCents ?? undefined,
        currency: pr.currency ?? undefined,
        hasCheckoutPrice: Boolean(pr.providerPriceId),
      })),
    };
  });
  sendSuccess(res, { items });
}

export async function assignBusinessPlanHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as CreateSubscriptionInput;

  const subscription = await assignPlanToBusiness(businessId, body.planCode, body.billingInterval);
  await auditAcrossBusiness(businessId, req, "subscription.created", subscription._id, {
    planCode: body.planCode,
    assignedBy: "platform_admin",
  });

  sendSuccess(res, { subscription: subscription.toJSON() }, 201);
}

export async function assignAgencyPlanHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const body = req.body as CreateSubscriptionInput;

  const subscription = await assignPlanToAgency(agencyId, body.planCode, body.billingInterval);
  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.subscription_created",
    targetType: "subscription",
    targetId: subscription._id,
    metadata: { planCode: body.planCode, assignedBy: "platform_admin" },
  });

  sendSuccess(res, { subscription: subscription.toJSON() }, 201);
}
