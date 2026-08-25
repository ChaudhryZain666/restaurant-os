import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { ChangeSubscriptionPlanInput, CreateSubscriptionInput, PaginationQueryInput } from "@restaurant/validation";
import { Plan, type PlanDoc } from "../models/Plan.js";
import type { SubscriptionDoc } from "../models/Subscription.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { sendSuccess } from "../common/response.js";
import { paginateQuery } from "../utils/pagination.js";
import { env } from "../config/env.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { getEntitlements } from "../services/entitlement.service.js";
import { getAgencyEntitlements as getAgencyBusinessUsage } from "../services/agencyEntitlement.service.js";
import {
  cancelAgencySubscription,
  changeAgencySubscriptionPlan,
  createCheckoutSessionForAgency,
  createSubscriptionForAgency,
  getSubscriptionForAgency,
  reactivateAgencySubscription,
} from "../services/subscription.service.js";

/**
 * Phase 25 — the agency-level counterpart to subscription.controller.ts, using the same
 * response shape (subscription + plan) and the same "no subscription id in the URL" API surface
 * (at most one live subscription per agency, DB-enforced). Audit entries go to AgencyAuditLog
 * (agency-scoped, no restaurantId to fan out to — an agency may have zero businesses), not the
 * business-scoped AuditLog.
 */
async function toResponseShape(subscription: HydratedDocument<SubscriptionDoc>) {
  const plan = await Plan.findById(subscription.planId);
  const pastDueDeadline =
    subscription.status === "past_due"
      ? new Date(subscription.updatedAt.getTime() + env.PAST_DUE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  return { subscription: subscription.toJSON(), plan: plan ? plan.toJSON() : null, pastDueDeadline };
}

export async function getAgencySubscriptionHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const subscription = await getSubscriptionForAgency(agencyId);
  if (!subscription) {
    sendSuccess(res, { subscription: null, plan: null });
    return;
  }
  sendSuccess(res, await toResponseShape(subscription));
}

export async function createAgencySubscriptionHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const body = req.body as CreateSubscriptionInput;

  const subscription = await createSubscriptionForAgency(agencyId, body.planCode, body.billingInterval);
  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.subscription_created",
    targetType: "subscription",
    targetId: subscription._id,
    metadata: { planCode: body.planCode },
  });

  sendSuccess(res, await toResponseShape(subscription), 201);
}

export async function cancelAgencySubscriptionHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const subscription = await cancelAgencySubscription(agencyId);
  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.subscription_cancellation_requested",
    targetType: "subscription",
    targetId: subscription._id,
    metadata: { status: subscription.status },
  });
  sendSuccess(res, await toResponseShape(subscription));
}

export async function reactivateAgencySubscriptionHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const subscription = await reactivateAgencySubscription(agencyId);
  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.subscription_reactivated",
    targetType: "subscription",
    targetId: subscription._id,
  });
  sendSuccess(res, await toResponseShape(subscription));
}

export async function changeAgencyPlanHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const body = req.body as ChangeSubscriptionPlanInput;
  const subscription = await changeAgencySubscriptionPlan(agencyId, body.planCode);
  await recordAgencyAuditEvent({
    agencyId,
    actorUserId: req.user!.id,
    actorRole: req.user!.role,
    action: "agency.subscription_plan_changed",
    targetType: "subscription",
    targetId: subscription._id,
    metadata: { planCode: body.planCode },
  });
  sendSuccess(res, await toResponseShape(subscription));
}

/**
 * Phase 28 — extended to also return business-usage-vs-limit (agencyEntitlement.service.ts's
 * getAgencyEntitlements, confusingly same-named as this handler — aliased on import), not just
 * plan feature flags. The usage figure is meaningful even with no live subscription (the
 * no-subscription-default fallback applies), so this no longer 404s in that case — only the
 * feature-entitlements half is omitted when there's no plan to read them from.
 */
export async function getAgencyEntitlementsHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const [subscription, usage] = await Promise.all([getSubscriptionForAgency(agencyId), getAgencyBusinessUsage(agencyId)]);
  if (!subscription) {
    sendSuccess(res, { entitlements: null, usage });
    return;
  }
  const plan = await Plan.findById(subscription.planId);
  sendSuccess(res, { entitlements: plan ? getEntitlements(plan as PlanDoc) : null, usage });
}

export async function createAgencyCheckoutHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const body = req.body as CreateSubscriptionInput;
  const checkout = await createCheckoutSessionForAgency(agencyId, body.planCode, body.billingInterval);
  sendSuccess(res, { checkout });
}

export async function getAgencyBillingHistoryHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const { page, limit } = req.query as unknown as PaginationQueryInput;
  const result = await paginateQuery(BillingHistoryEvent.find({ ownerType: "agency", ownerId: agencyId }).sort({ occurredAt: -1 }), {
    page,
    limit,
  });
  sendSuccess(res, { ...result, items: result.items.map((e) => e.toJSON()) });
}
