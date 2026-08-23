import type { Request, Response } from "express";
import type { HydratedDocument, Types } from "mongoose";
import type { CreateSubscriptionInput, ChangeSubscriptionPlanInput } from "@restaurant/validation";
import { Plan, type PlanDoc } from "../models/Plan.js";
import type { SubscriptionDoc } from "../models/Subscription.js";
import { Restaurant } from "../models/Restaurant.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { getEntitlements } from "../services/entitlement.service.js";
import {
  cancelSubscription,
  changeSubscriptionPlan,
  createSubscriptionForBusiness,
  getSubscriptionForBusiness,
  reactivateSubscription,
} from "../services/subscription.service.js";

/**
 * Phase 24 — billing is business-level (one subscription per business, regardless of location
 * count), but AuditLog stays restaurantId-scoped (no schema change this phase). Fans out one
 * entry per Restaurant under the business, mirroring businessPromotion.controller.ts's
 * auditAcrossLocations exactly.
 */
async function auditAcrossBusiness(
  businessId: string,
  req: Request,
  action:
    | "subscription.created"
    | "subscription.plan_changed"
    | "subscription.cancellation_requested"
    | "subscription.reactivated"
    | "subscription.cancelled",
  subscriptionId: Types.ObjectId,
  metadata?: Record<string, unknown>
) {
  const restaurants = await Restaurant.find({ businessId }).select("_id");
  await Promise.all(
    restaurants.map((r) =>
      recordAuditEvent({
        restaurantId: r._id,
        actorUserId: req.user!.id,
        actorRole: req.user!.role,
        action,
        targetType: "subscription",
        targetId: subscriptionId,
        metadata,
      })
    )
  );
}

async function toResponseShape(subscription: HydratedDocument<SubscriptionDoc>) {
  const plan = await Plan.findById(subscription.planId);
  return {
    subscription: subscription.toJSON(),
    plan: plan ? plan.toJSON() : null,
  };
}

export async function getSubscription(req: Request, res: Response) {
  const { businessId } = req.params;
  const subscription = await getSubscriptionForBusiness(businessId);
  if (!subscription) {
    sendSuccess(res, { subscription: null, plan: null });
    return;
  }
  sendSuccess(res, await toResponseShape(subscription));
}

export async function createSubscription(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as CreateSubscriptionInput;

  const subscription = await createSubscriptionForBusiness(businessId, body.planCode, body.billingInterval);
  await auditAcrossBusiness(businessId, req, "subscription.created", subscription._id, { planCode: body.planCode });

  sendSuccess(res, await toResponseShape(subscription), 201);
}

export async function cancelSubscriptionHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const subscription = await cancelSubscription(businessId);
  await auditAcrossBusiness(businessId, req, "subscription.cancellation_requested", subscription._id, {
    status: subscription.status,
  });
  sendSuccess(res, await toResponseShape(subscription));
}

export async function reactivateSubscriptionHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const subscription = await reactivateSubscription(businessId);
  await auditAcrossBusiness(businessId, req, "subscription.reactivated", subscription._id);
  sendSuccess(res, await toResponseShape(subscription));
}

export async function changePlanHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as ChangeSubscriptionPlanInput;
  const subscription = await changeSubscriptionPlan(businessId, body.planCode);
  await auditAcrossBusiness(businessId, req, "subscription.plan_changed", subscription._id, { planCode: body.planCode });
  sendSuccess(res, await toResponseShape(subscription));
}

export async function getEntitlementsHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const subscription = await getSubscriptionForBusiness(businessId);
  if (!subscription) throw ApiError.notFound("This business has no subscription");
  const plan = await Plan.findById(subscription.planId);
  if (!plan) throw ApiError.notFound("Subscription plan not found");
  sendSuccess(res, { entitlements: getEntitlements(plan as PlanDoc) });
}
