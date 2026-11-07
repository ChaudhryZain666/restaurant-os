import type { Request, Response } from "express";
import type { HydratedDocument } from "mongoose";
import type {
  AdminCancelSubscriptionInput,
  ChangeManualSubscriptionPlanInput,
  CreateManualSubscriptionInput,
  CreateSubscriptionInput,
  ExtendManualSubscriptionInput,
  PaginationQueryInput,
  SuspendManualSubscriptionInput,
} from "@restaurant/validation";
import type { AgencyAuditAction, PlatformPlanOption, SubscriptionOwnerType } from "@restaurant/types";
import { Plan } from "../models/Plan.js";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { sendSuccess } from "../common/response.js";
import { ApiError } from "../utils/ApiError.js";
import { paginateQuery } from "../utils/pagination.js";
import { recordAgencyAuditEvent } from "../services/agencyAudit.service.js";
import { assignPlanToAgency, assignPlanToBusiness, resolveTrialDays } from "../services/subscription.service.js";
import {
  adminCancelSubscription,
  changeManualSubscriptionPlan,
  createManualSubscription,
  extendManualSubscription,
  resumeManualSubscription,
  suspendManualSubscription,
  toPlatformSubscriptionSummary,
  unsuspendManualSubscription,
} from "../services/platformSubscription.service.js";
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

// ---------------------------------------------------------------------------------------------
// Platform-admin manual subscriptions (provider "manual" — services/platformSubscription.service.ts).
// Every change is audited on the owner's own log: each of a business's locations (AuditLog) or the
// agency (AgencyAuditLog), naming the acting platform admin.
// ---------------------------------------------------------------------------------------------

type SubscriptionAuditKind =
  | "created"
  | "plan_changed"
  | "extended"
  | "suspended"
  | "unsuspended"
  | "cancellation_requested"
  | "cancelled"
  | "reactivated";

const BUSINESS_AUDIT_ACTION: Record<SubscriptionAuditKind, Parameters<typeof auditAcrossBusiness>[2]> = {
  created: "subscription.created",
  plan_changed: "subscription.plan_changed",
  extended: "subscription.extended",
  suspended: "subscription.suspended",
  unsuspended: "subscription.unsuspended",
  cancellation_requested: "subscription.cancellation_requested",
  cancelled: "subscription.cancelled",
  reactivated: "subscription.reactivated",
};

const AGENCY_AUDIT_ACTION: Record<SubscriptionAuditKind, AgencyAuditAction> = {
  created: "agency.subscription_created",
  plan_changed: "agency.subscription_plan_changed",
  extended: "agency.subscription_extended",
  suspended: "agency.subscription_suspended",
  unsuspended: "agency.subscription_unsuspended",
  cancellation_requested: "agency.subscription_cancellation_requested",
  cancelled: "agency.subscription_cancelled",
  reactivated: "agency.subscription_reactivated",
};

async function auditSubscription(req: Request, sub: HydratedDocument<SubscriptionDoc>, kind: SubscriptionAuditKind, metadata: Record<string, unknown>) {
  const details = { ...metadata, assignedBy: "platform_admin", provider: sub.provider };
  if (sub.ownerType === "agency") {
    await recordAgencyAuditEvent({
      agencyId: sub.ownerId.toString(),
      actorUserId: req.user!.id,
      actorRole: req.user!.role,
      action: AGENCY_AUDIT_ACTION[kind],
      targetType: "subscription",
      targetId: sub._id,
      metadata: details,
    });
    return;
  }
  await auditAcrossBusiness(sub.ownerId.toString(), req, BUSINESS_AUDIT_ACTION[kind], sub._id, details);
}

async function summaryResponse(res: Response, sub: HydratedDocument<SubscriptionDoc>, status = 200) {
  const plan = await Plan.findById(sub.planId).select("code name");
  sendSuccess(res, { subscription: toPlatformSubscriptionSummary(sub, plan) }, status);
}

async function createManualFor(ownerType: SubscriptionOwnerType, ownerId: string, req: Request, res: Response) {
  const body = req.body as CreateManualSubscriptionInput;
  const sub = await createManualSubscription(ownerType, ownerId, body, req.user!.id);
  await auditSubscription(req, sub, "created", {
    kind: body.kind,
    planCode: body.planCode,
    billingInterval: body.billingInterval,
    agreedAmountCents: sub.manualBilling?.amountCents,
    currency: sub.manualBilling?.currency,
    startsAt: sub.currentPeriodStart,
    endsAt: sub.currentPeriodEnd,
  });
  await summaryResponse(res, sub, 201);
}

/** POST /platform/businesses/:businessId/subscription/manual */
export async function createManualBusinessSubscriptionHandler(req: Request, res: Response) {
  await createManualFor("business", req.params.businessId, req, res);
}

/** POST /platform/agencies/:agencyId/subscription/manual */
export async function createManualAgencySubscriptionHandler(req: Request, res: Response) {
  await createManualFor("agency", req.params.agencyId, req, res);
}

/** POST /platform/subscriptions/:subscriptionId/extend */
export async function extendManualSubscriptionHandler(req: Request, res: Response) {
  const body = req.body as ExtendManualSubscriptionInput;
  const { subscription, previousEnd } = await extendManualSubscription(req.params.subscriptionId, body);
  await auditSubscription(req, subscription, "extended", { from: previousEnd, to: subscription.currentPeriodEnd });
  await summaryResponse(res, subscription);
}

/** POST /platform/subscriptions/:subscriptionId/change-plan */
export async function changeManualSubscriptionPlanHandler(req: Request, res: Response) {
  const body = req.body as ChangeManualSubscriptionPlanInput;
  const { subscription, previousPlanCode } = await changeManualSubscriptionPlan(req.params.subscriptionId, body);
  await auditSubscription(req, subscription, "plan_changed", {
    fromPlanCode: previousPlanCode,
    newPlanCode: body.planCode,
    billingInterval: body.billingInterval,
    agreedAmountCents: subscription.manualBilling?.amountCents,
  });
  await summaryResponse(res, subscription);
}

/** POST /platform/subscriptions/:subscriptionId/suspend */
export async function suspendManualSubscriptionHandler(req: Request, res: Response) {
  const body = req.body as SuspendManualSubscriptionInput;
  const sub = await suspendManualSubscription(req.params.subscriptionId, body.reason);
  await auditSubscription(req, sub, "suspended", { reason: body.reason });
  await summaryResponse(res, sub);
}

/** POST /platform/subscriptions/:subscriptionId/unsuspend */
export async function unsuspendManualSubscriptionHandler(req: Request, res: Response) {
  const sub = await unsuspendManualSubscription(req.params.subscriptionId);
  await auditSubscription(req, sub, "unsuspended", {});
  await summaryResponse(res, sub);
}

/** POST /platform/subscriptions/:subscriptionId/resume */
export async function resumeManualSubscriptionHandler(req: Request, res: Response) {
  const sub = await resumeManualSubscription(req.params.subscriptionId);
  await auditSubscription(req, sub, "reactivated", {});
  await summaryResponse(res, sub);
}

/** POST /platform/subscriptions/:subscriptionId/cancel */
export async function adminCancelSubscriptionHandler(req: Request, res: Response) {
  const body = req.body as AdminCancelSubscriptionInput;
  const sub = await adminCancelSubscription(req.params.subscriptionId, body);
  await auditSubscription(req, sub, sub.status === "cancelling" ? "cancellation_requested" : "cancelled", { when: body.when });
  await summaryResponse(res, sub);
}

/** GET /platform/subscriptions/:subscriptionId */
export async function getPlatformSubscriptionHandler(req: Request, res: Response) {
  const sub = await Subscription.findById(req.params.subscriptionId);
  if (!sub) throw ApiError.notFound("Subscription not found");
  await summaryResponse(res, sub);
}

async function billingHistoryFor(ownerType: SubscriptionOwnerType, ownerId: string, req: Request, res: Response) {
  const exists = ownerType === "agency" ? await Agency.exists({ _id: ownerId }) : await Business.exists({ _id: ownerId });
  if (!exists) throw ApiError.notFound(ownerType === "agency" ? "Agency not found" : "Business not found");
  const { page, limit } = req.query as unknown as PaginationQueryInput;
  const result = await paginateQuery(BillingHistoryEvent.find({ ownerType, ownerId }).sort({ occurredAt: -1 }), { page, limit });
  const latest = await Subscription.findOne({ ownerType, ownerId }).sort({ createdAt: -1 });
  const plan = latest ? await Plan.findById(latest.planId).select("code name") : null;
  sendSuccess(res, {
    ...result,
    items: result.items.map((e) => e.toJSON()),
    subscription: latest ? toPlatformSubscriptionSummary(latest, plan) : null,
  });
}

/** GET /platform/businesses/:businessId/billing-history */
export async function getBusinessBillingHistoryHandler(req: Request, res: Response) {
  await billingHistoryFor("business", req.params.businessId, req, res);
}

/** GET /platform/agencies/:agencyId/billing-history */
export async function getAgencyBillingHistoryHandler(req: Request, res: Response) {
  await billingHistoryFor("agency", req.params.agencyId, req, res);
}
