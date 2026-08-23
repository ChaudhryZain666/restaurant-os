import type { Request, Response } from "express";
import type { HydratedDocument, Types } from "mongoose";
import type { CreateSubscriptionInput, ChangeSubscriptionPlanInput } from "@restaurant/validation";
import type { PaginationQueryInput } from "@restaurant/validation";
import { Plan, type PlanDoc } from "../models/Plan.js";
import type { SubscriptionDoc } from "../models/Subscription.js";
import { Restaurant } from "../models/Restaurant.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { ApiError } from "../utils/ApiError.js";
import { sendSuccess } from "../common/response.js";
import { paginateQuery } from "../utils/pagination.js";
import { env } from "../config/env.js";
import { recordAuditEvent } from "../services/audit.service.js";
import { getEntitlements } from "../services/entitlement.service.js";
import { getLocationLimitStatus } from "../services/entitlementLimit.service.js";
import {
  cancelSubscription,
  changeSubscriptionPlan,
  createCheckoutSessionForBusiness,
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

/**
 * Phase 27 — pastDueDeadline is PURELY UI messaging ("you have until X to fix your payment"), never
 * a server-enforced expiry: this platform never unilaterally cancels a past_due subscription on a
 * timer — only the billing provider's own webhook (reporting the outcome of ITS OWN dunning/retry
 * process) drives that transition, via the existing past_due -> cancelled path in
 * processBillingProviderEvent. See docs/commercial-decisions.md's "Failed-payment policy" section.
 */
async function toResponseShape(subscription: HydratedDocument<SubscriptionDoc>) {
  const plan = await Plan.findById(subscription.planId);
  const pastDueDeadline =
    subscription.status === "past_due"
      ? new Date(subscription.updatedAt.getTime() + env.PAST_DUE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : undefined;
  return {
    subscription: subscription.toJSON(),
    plan: plan ? plan.toJSON() : null,
    pastDueDeadline,
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

/** GET /businesses/:businessId/subscription/location-limit — a pre-check for the LocationsPage
 *  "add location" affordance. Never itself authoritative — the real, atomic guard is
 *  reserveLocationSlot, enforced again server-side on the actual create request regardless of what
 *  this returned. */
export async function getLocationLimitHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  sendSuccess(res, await getLocationLimitStatus(businessId));
}

/**
 * POST /businesses/:businessId/subscription/checkout — the payment-method-up-front entry point
 * (see subscription.service.ts's createCheckoutSessionCore doc comment). Deliberately does NOT
 * create a Subscription or write an audit/billing-history entry here — nothing real has happened
 * yet, only once the provider's webhook reports completion does anything get created.
 */
export async function createCheckoutHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const body = req.body as CreateSubscriptionInput;
  const checkout = await createCheckoutSessionForBusiness(businessId, body.planCode, body.billingInterval);
  sendSuccess(res, { checkout });
}

/**
 * GET /businesses/:businessId/subscription/billing-history — the normalized, product-facing read
 * model (BillingHistoryEvent) that also doubles as the Invoices list (payment_succeeded rows carry
 * a receiptUrl to the provider's own hosted invoice page). Never exposes provider internals beyond
 * providerReference (an opaque id, not a credential).
 */
export async function getBillingHistoryHandler(req: Request, res: Response) {
  const { businessId } = req.params;
  const { page, limit } = req.query as unknown as PaginationQueryInput;
  const result = await paginateQuery(BillingHistoryEvent.find({ ownerType: "business", ownerId: businessId }).sort({ occurredAt: -1 }), {
    page,
    limit,
  });
  sendSuccess(res, { ...result, items: result.items.map((e) => e.toJSON()) });
}
