import type { HydratedDocument } from "mongoose";
import type { BillingInterval, SubscriptionOwnerType, SubscriptionStatus } from "@restaurant/types";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { Plan, type PlanDoc } from "../models/Plan.js";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { User } from "../models/User.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getBillingProvider } from "../billing/index.js";
import type { ProviderBillingWebhookEvent, ProviderSubscriptionStatus } from "../billing/BillingProvider.js";
import { isValidSubscriptionTransition } from "./subscriptionStateMachine.js";

const LIVE_STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelling"];

const OWNER_LABEL: Record<SubscriptionOwnerType, string> = { business: "business", agency: "agency" };

/**
 * Phase 25 — resolves the {name, email} a billing provider customer record needs, for either owner
 * type. `Business`'s owner-plan path (createSubscriptionForBusiness) was the only reachable one
 * through Phase 24; this is the shared core both it and the new agency path
 * (createSubscriptionForAgency) now go through, so Phase 24's business behavior/tests are
 * byte-for-byte unchanged — only the lookup itself was extracted.
 */
async function resolveOwnerIdentity(
  ownerType: SubscriptionOwnerType,
  ownerId: string
): Promise<{ name: string; email: string } | null> {
  if (ownerType === "business") {
    const business = await Business.findById(ownerId);
    if (!business) return null;
    const owner = await User.findById(business.ownerId).select("email name");
    return { name: business.name, email: owner?.email ?? "" };
  }
  const agency = await Agency.findById(ownerId);
  if (!agency) return null;
  return { name: agency.name, email: agency.contactEmail };
}

/**
 * Shared core for both `createSubscriptionForBusiness` and `createSubscriptionForAgency`. The
 * partial unique index on {ownerType, ownerId} is the real concurrency guard: two simultaneous
 * create attempts for the same owner race the insert, and the loser gets a clean 409, not a silent
 * duplicate — the pre-check below only narrows the common case.
 */
async function createSubscriptionCore(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<HydratedDocument<SubscriptionDoc>> {
  const identity = await resolveOwnerIdentity(ownerType, ownerId);
  if (!identity) throw ApiError.notFound(`${ownerType === "business" ? "Business" : "Agency"} not found`);

  const existing = await Subscription.findOne({ ownerType, ownerId, status: { $in: LIVE_STATUSES } });
  if (existing) throw ApiError.conflict(`This ${OWNER_LABEL[ownerType]} already has an active subscription`);

  const plan = await Plan.findOne({ code: planCode, isActive: true });
  if (!plan) throw ApiError.badRequest("Unknown or inactive plan");

  const provider = getBillingProvider();
  const customer = await provider.createCustomer({ ownerType, ownerId, email: identity.email, name: identity.name });
  const providerSub = await provider.createSubscription({
    providerCustomerId: customer.providerCustomerId,
    planCode: plan.code,
    billingInterval,
    trialDays: env.TRIAL_PERIOD_DAYS > 0 ? env.TRIAL_PERIOD_DAYS : undefined,
  });

  const status: SubscriptionStatus = providerSub.status === "trialing" ? "trialing" : "active";

  try {
    return await Subscription.create({
      ownerType,
      ownerId,
      planId: plan._id,
      status,
      billingInterval,
      currentPeriodStart: providerSub.currentPeriodStart,
      currentPeriodEnd: providerSub.currentPeriodEnd,
      trialStart: status === "trialing" ? new Date() : undefined,
      trialEnd: providerSub.trialEnd,
      provider: provider.name,
      providerCustomerId: customer.providerCustomerId,
      providerSubscriptionId: providerSub.providerSubscriptionId,
    });
  } catch (err) {
    // Backstop for the genuine race the pre-check above can't close.
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict(`This ${OWNER_LABEL[ownerType]} already has an active subscription`);
    }
    throw err;
  }
}

export async function createSubscriptionForBusiness(
  businessId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<HydratedDocument<SubscriptionDoc>> {
  return createSubscriptionCore("business", businessId, planCode, billingInterval);
}

export async function createSubscriptionForAgency(
  agencyId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<HydratedDocument<SubscriptionDoc>> {
  return createSubscriptionCore("agency", agencyId, planCode, billingInterval);
}

export async function getSubscriptionForBusiness(businessId: string): Promise<HydratedDocument<SubscriptionDoc> | null> {
  return Subscription.findOne({ ownerType: "business", ownerId: businessId }).sort({ createdAt: -1 });
}

export async function getSubscriptionForAgency(agencyId: string): Promise<HydratedDocument<SubscriptionDoc> | null> {
  return Subscription.findOne({ ownerType: "agency", ownerId: agencyId }).sort({ createdAt: -1 });
}

/** There is at most one LIVE subscription per owner (the partial unique index enforces this at
 *  the DB level), so lifecycle actions are addressed by ownerId alone — no subscription id in
 *  the URL, matching the API surface established in Phase 24. */
async function getLiveSubscriptionOrThrow(
  ownerType: SubscriptionOwnerType,
  ownerId: string
): Promise<HydratedDocument<SubscriptionDoc>> {
  const subscription = await Subscription.findOne({ ownerType, ownerId, status: { $in: LIVE_STATUSES } });
  if (!subscription) throw ApiError.notFound(`This ${OWNER_LABEL[ownerType]} has no active subscription`);
  return subscription;
}

/**
 * Schedules cancellation at the end of the current billing period when there IS a real committed
 * period to run out — only "active" supports that ("cancelling" per subscriptionStateMachine.ts).
 * A "trialing" subscription has never been charged, and "past_due" has already failed to bill, so
 * for either of those cancelling is immediate ("cancelled" directly) regardless of atPeriodEnd —
 * there's no paid period to let the customer keep using. `atPeriodEnd:false` on an "active"
 * subscription is retained as an internal capability (used by tests exercising the provider
 * abstraction directly) but not exposed through the owner-facing API this phase.
 */
async function cancelSubscriptionCore(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  atPeriodEnd = true
): Promise<HydratedDocument<SubscriptionDoc>> {
  const subscription = await getLiveSubscriptionOrThrow(ownerType, ownerId);
  if (subscription.status === "cancelling") {
    throw ApiError.badRequest("This subscription is already scheduled to cancel");
  }
  const targetStatus: SubscriptionStatus = subscription.status === "active" && atPeriodEnd ? "cancelling" : "cancelled";
  if (!isValidSubscriptionTransition(subscription.status, targetStatus)) {
    throw ApiError.badRequest(`Cannot cancel a subscription with status "${subscription.status}"`);
  }

  const provider = getBillingProvider();
  if (subscription.providerSubscriptionId) {
    await provider.cancelSubscription(subscription.providerSubscriptionId, targetStatus === "cancelling");
  }

  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: subscription.status },
    {
      $set: {
        status: targetStatus,
        ...(targetStatus === "cancelling" ? { cancelAt: subscription.currentPeriodEnd } : { cancelledAt: new Date() }),
      },
    },
    { new: true }
  );
  if (!updated) throw ApiError.conflict("This subscription was just modified — please retry");
  return updated;
}

export async function cancelSubscription(businessId: string, atPeriodEnd = true): Promise<HydratedDocument<SubscriptionDoc>> {
  return cancelSubscriptionCore("business", businessId, atPeriodEnd);
}

export async function cancelAgencySubscription(agencyId: string, atPeriodEnd = true): Promise<HydratedDocument<SubscriptionDoc>> {
  return cancelSubscriptionCore("agency", agencyId, atPeriodEnd);
}

/** Un-cancels a scheduled (not yet effective) cancellation — only valid from "cancelling". */
async function reactivateSubscriptionCore(ownerType: SubscriptionOwnerType, ownerId: string): Promise<HydratedDocument<SubscriptionDoc>> {
  const subscription = await getLiveSubscriptionOrThrow(ownerType, ownerId);
  if (!isValidSubscriptionTransition(subscription.status, "active")) {
    throw ApiError.badRequest(`Cannot reactivate a subscription with status "${subscription.status}"`);
  }

  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: subscription.status },
    { $set: { status: "active" }, $unset: { cancelAt: "" } },
    { new: true }
  );
  if (!updated) throw ApiError.conflict("This subscription was just modified — please retry");
  return updated;
}

export async function reactivateSubscription(businessId: string): Promise<HydratedDocument<SubscriptionDoc>> {
  return reactivateSubscriptionCore("business", businessId);
}

export async function reactivateAgencySubscription(agencyId: string): Promise<HydratedDocument<SubscriptionDoc>> {
  return reactivateSubscriptionCore("agency", agencyId);
}

async function changeSubscriptionPlanCore(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  newPlanCode: string
): Promise<HydratedDocument<SubscriptionDoc>> {
  const subscription = await getLiveSubscriptionOrThrow(ownerType, ownerId);
  if (!["trialing", "active", "past_due"].includes(subscription.status)) {
    throw ApiError.badRequest(`Cannot change plan on a subscription with status "${subscription.status}"`);
  }
  const plan = await Plan.findOne({ code: newPlanCode, isActive: true });
  if (!plan) throw ApiError.badRequest("Unknown or inactive plan");

  const provider = getBillingProvider();
  if (subscription.providerSubscriptionId) {
    await provider.changePlan(subscription.providerSubscriptionId, newPlanCode);
  }

  subscription.planId = plan._id;
  await subscription.save();
  return subscription;
}

export async function changeSubscriptionPlan(businessId: string, newPlanCode: string): Promise<HydratedDocument<SubscriptionDoc>> {
  return changeSubscriptionPlanCore("business", businessId, newPlanCode);
}

export async function changeAgencySubscriptionPlan(agencyId: string, newPlanCode: string): Promise<HydratedDocument<SubscriptionDoc>> {
  return changeSubscriptionPlanCore("agency", agencyId, newPlanCode);
}

export async function getPlanForSubscription(subscription: Pick<SubscriptionDoc, "planId">): Promise<HydratedDocument<PlanDoc> | null> {
  return Plan.findById(subscription.planId);
}

/**
 * A provider-reported "cancelled" while OUR side was still "trialing" always means the trial ended
 * without converting — a user-initiated cancel DURING a trial goes through cancelSubscription()
 * above directly (an owner action, immediate, never waits for a webhook), so a webhook can only
 * ever observe involuntary trial expiry from that starting state, never a deliberate cancel.
 */
function resolveTransitionTarget(currentStatus: SubscriptionStatus, providerStatus: ProviderSubscriptionStatus): SubscriptionStatus {
  if (providerStatus === "cancelled" && currentStatus === "trialing") return "expired";
  return providerStatus;
}

/**
 * The single entry point every inbound billing webhook (real or mock-simulated) goes through, for
 * BOTH business and agency subscriptions — the lookup below is keyed by providerSubscriptionId
 * alone, ownerType-agnostic, so no change was needed here for Phase 25. Idempotent by construction,
 * mirroring payment.service.ts's processProviderEvent exactly: the insert into BillingWebhookEvent
 * is the source of truth for "have we seen this event before," not an in-application check. No
 * outbound provider call happens inside this function (unlike refundPayment), so a plain atomic
 * guard is sufficient — no transaction needed for a single-document update.
 */
export async function processBillingProviderEvent(providerName: string, event: ProviderBillingWebhookEvent): Promise<void> {
  try {
    await BillingWebhookEvent.create({
      provider: providerName,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.raw,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.info("duplicate billing webhook event ignored", { provider: providerName, eventId: event.eventId });
      return;
    }
    throw err;
  }

  const subscription = await Subscription.findOne({ provider: providerName, providerSubscriptionId: event.providerSubscriptionId });
  if (!subscription) {
    logger.warn("billing webhook event for unknown subscription reference", {
      provider: providerName,
      providerSubscriptionId: event.providerSubscriptionId,
    });
    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: "No matching subscription for providerSubscriptionId" } }
    );
    return;
  }

  const targetStatus = resolveTransitionTarget(subscription.status, event.status);
  if (!isValidSubscriptionTransition(subscription.status, targetStatus)) {
    logger.warn("ignored invalid subscription status transition from webhook", {
      subscriptionId: subscription.id,
      from: subscription.status,
      to: targetStatus,
    });
    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processedAt: new Date(), processingError: `Ignored: ${subscription.status} -> ${targetStatus}` } }
    );
    return;
  }

  // Guarded by status: {$ne: to} so a race between two deliveries of the same real-world
  // transition can't apply it twice — mirrors payment.service.ts's webhook-driven status guard.
  await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: { $ne: targetStatus } },
    { $set: { status: targetStatus, ...(targetStatus === "cancelled" ? { cancelledAt: new Date() } : {}) } }
  );

  await BillingWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
}
