import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type { ChangeSubscriptionPlanInput, CreateSubscriptionInput, PaginationQueryInput } from "@restaurant/validation";
import { Plan, type PlanDoc } from "../models/Plan.js";
import type { SubscriptionDoc } from "../models/Subscription.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { paginateQuery } from "../utils/pagination.js";
import { env } from "../config/env.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { getEntitlements } from "../services/entitlement.service.js";
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

export async function getAgencyEntitlementsHandler(req: Request, res: Response) {
  const { agencyId } = req.params;
  const subscription = await getSubscriptionForAgency(agencyId);
  if (!subscription) throw ApiError.notFound("This agency has no subscription");
  const plan = await Plan.findById(subscription.planId);
  if (!plan) throw ApiError.notFound("Subscription plan not found");
  sendSuccess(res, { entitlements: getEntitlements(plan as PlanDoc) });
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
