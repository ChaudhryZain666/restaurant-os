import type { HydratedDocument } from "mongoose";
import type { BillingHistoryEventType, BillingInterval, SubscriptionOwnerType, SubscriptionStatus } from "@restaurant/types";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { Plan, type PlanDoc } from "../models/Plan.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { getBillingProvider } from "../billing/index.js";
import type { ProviderBillingWebhookEvent, ProviderCheckoutSession, ProviderSubscriptionStatus } from "../billing/BillingProvider.js";
import { isValidSubscriptionTransition } from "./subscriptionStateMachine.js";
import { recordBillingHistoryEvent } from "./billingHistory.service.js";
import { resolveOwnerIdentity } from "./ownerIdentity.service.js";

const LIVE_STATUSES: SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelling"];

const OWNER_LABEL: Record<SubscriptionOwnerType, string> = { business: "business", agency: "agency" };

// Phase 37 audit finding — Plan.type ("OWNER"/"AGENCY", the commercial tier) and
// Subscription.ownerType ("business"/"agency", the structural holder) were never actually
// cross-checked against each other anywhere: a request naming a valid, active, wrong-audience plan
// code (an AGENCY plan for a business, or vice versa) would previously succeed. Enforced once here,
// in the function both createSubscriptionForBusiness and createSubscriptionForAgency route through,
// so both directions are closed identically rather than only guarding the new self-serve owner path.
const EXPECTED_PLAN_TYPE: Record<SubscriptionOwnerType, "OWNER" | "AGENCY"> = { business: "OWNER", agency: "AGENCY" };

/** A Plan's own trialDays (Phase 27) overrides env.TRIAL_PERIOD_DAYS when set, so a future plan can
 *  legitimately differ (e.g. a no-trial plan) without touching the global default every other plan
 *  still relies on. 0 (from either source) means no trial at all, never a value invented here. */
export function resolveTrialDays(plan: Pick<PlanDoc, "trialDays">): number | undefined {
  const days = plan.trialDays ?? env.TRIAL_PERIOD_DAYS;
  return days > 0 ? days : undefined;
}

/** The interval-matched price, if the plan has one configured — used both to stamp economic terms
 *  onto a BillingHistoryEvent and to resolve a real provider's price identifier for checkout. */
function resolvePricing(plan: Pick<PlanDoc, "pricing">, billingInterval: BillingInterval) {
  return plan.pricing.find((p) => p.interval === billingInterval);
}

/**
 * Shared core for both `createSubscriptionForBusiness` and `createSubscriptionForAgency` — the
 * no-card-required trial entry point. The partial unique index on {ownerType, ownerId} is the real
 * concurrency guard: two simultaneous create attempts for the same owner race the insert, and the
 * loser gets a clean 409, not a silent duplicate — the pre-check below only narrows the common case.
 *
 * Phase 34 closure — deliberately contacts NO billing provider at all (verified against a real
 * Paddle sandbox account: Paddle's own docs state "you can't create a subscription directly" —
 * subscriptions are only ever born from a completed checkout or a manually-collected transaction,
 * so the direct-create call this function used to make here was structurally impossible against a
 * real provider, even though it "worked" against MockBillingProvider). The Subscription lives
 * purely locally — provider recorded as whichever one is configured, but providerCustomerId/
 * providerSubscriptionId left unset — until the owner goes through createCheckoutSessionCore to add
 * a payment method, either during the trial or to convert at its end.
 * `handleCheckoutCompletionEvent` below is the counterpart: it updates THIS document in place with
 * real provider identifiers rather than creating a second one.
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
  if (plan.type !== EXPECTED_PLAN_TYPE[ownerType]) {
    throw ApiError.badRequest(`This plan is not available for ${OWNER_LABEL[ownerType]} accounts`);
  }

  const trialDays = resolveTrialDays(plan);
  if (!trialDays) {
    throw ApiError.badRequest("This plan requires a payment method up front — start checkout to subscribe");
  }

  const now = new Date();
  const trialEnd = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

  let subscription: HydratedDocument<SubscriptionDoc>;
  try {
    subscription = await Subscription.create({
      ownerType,
      ownerId,
      planId: plan._id,
      status: "trialing",
      billingInterval,
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd,
      trialStart: now,
      trialEnd,
      provider: env.BILLING_PROVIDER as SubscriptionDoc["provider"],
    });
  } catch (err) {
    // Backstop for the genuine race the pre-check above can't close.
    if ((err as { code?: number }).code === 11000) {
      throw ApiError.conflict(`This ${OWNER_LABEL[ownerType]} already has an active subscription`);
    }
    throw err;
  }

  const pricing = resolvePricing(plan, billingInterval);
  await recordBillingHistoryEvent({
    ownerType,
    ownerId,
    subscriptionId: subscription._id,
    type: "subscription_created",
    provider: subscription.provider,
    amountCents: pricing?.amountCents,
    currency: pricing?.currency,
    metadata: { planCode: plan.code },
  });

  return subscription;
}

/**
 * Phase 27 — the checkout entry point: when a payment method needs to be collected up front (no
 * trial, or a trial requiring a card per the provider's own configuration), rather than the
 * direct-create path above (which never requires payment info — still exactly how a no-card trial
 * works, unchanged). NO Subscription document is created here — only once the provider's webhook
 * reports the checkout actually completed (see processBillingProviderEvent's checkoutMetadata
 * branch) does a real Subscription come into existence. An abandoned checkout is simply a no-op:
 * nothing was ever created to clean up.
 */
async function createCheckoutSessionCore(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<ProviderCheckoutSession> {
  const identity = await resolveOwnerIdentity(ownerType, ownerId);
  if (!identity) throw ApiError.notFound(`${ownerType === "business" ? "Business" : "Agency"} not found`);

  // A local-only trial (createSubscriptionCore — no providerSubscriptionId yet) is explicitly
  // ALLOWED to proceed to checkout: that's how it ever gets a real payment method attached. Only a
  // subscription already backed by a real provider resource blocks a second checkout.
  const existing = await Subscription.findOne({ ownerType, ownerId, status: { $in: LIVE_STATUSES } });
  if (existing?.providerSubscriptionId) {
    throw ApiError.conflict(`This ${OWNER_LABEL[ownerType]} already has an active subscription`);
  }

  const plan = await Plan.findOne({ code: planCode, isActive: true });
  if (!plan) throw ApiError.badRequest("Unknown or inactive plan");
  if (plan.type !== EXPECTED_PLAN_TYPE[ownerType]) {
    throw ApiError.badRequest(`This plan is not available for ${OWNER_LABEL[ownerType]} accounts`);
  }

  const pricing = resolvePricing(plan, billingInterval);
  if (!pricing?.providerPriceId) {
    throw ApiError.badRequest("This plan has no checkout price configured for that billing interval yet");
  }

  const provider = getBillingProvider();
  const customer = await provider.createCustomer({ ownerType, ownerId, email: identity.email, name: identity.name });

  return provider.createCheckoutSession({
    providerCustomerId: customer.providerCustomerId,
    providerPriceId: pricing.providerPriceId,
    metadata: { ownerType, ownerId, planCode: plan.code, billingInterval },
    successUrl: `${env.ADMIN_ORIGIN}/billing-checkout-complete`,
    cancelUrl: `${env.ADMIN_ORIGIN}/billing`,
  });
}

export async function createCheckoutSessionForBusiness(
  businessId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<ProviderCheckoutSession> {
  return createCheckoutSessionCore("business", businessId, planCode, billingInterval);
}

export async function createCheckoutSessionForAgency(
  agencyId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<ProviderCheckoutSession> {
  return createCheckoutSessionCore("agency", agencyId, planCode, billingInterval);
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

  const historyType: BillingHistoryEventType = targetStatus === "cancelling" ? "cancellation_requested" : "cancelled";
  await recordBillingHistoryEvent({
    ownerType,
    ownerId,
    subscriptionId: updated._id,
    type: historyType,
    provider: updated.provider,
  });

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

  const provider = getBillingProvider();
  if (subscription.providerSubscriptionId) {
    await provider.reactivateSubscription(subscription.providerSubscriptionId);
  }

  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: subscription.status },
    { $set: { status: "active" }, $unset: { cancelAt: "" } },
    { new: true }
  );
  if (!updated) throw ApiError.conflict("This subscription was just modified — please retry");

  await recordBillingHistoryEvent({ ownerType, ownerId, subscriptionId: updated._id, type: "reactivated", provider: updated.provider });

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

  const pricing = resolvePricing(plan, subscription.billingInterval);
  await recordBillingHistoryEvent({
    ownerType,
    ownerId,
    subscriptionId: subscription._id,
    type: "plan_changed",
    provider: subscription.provider,
    amountCents: pricing?.amountCents,
    currency: pricing?.currency,
    metadata: { newPlanCode },
  });

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

/** Maps a just-applied status transition to the billing-history event type it represents, or
 *  undefined for a transition with no distinct history entry of its own. */
const HISTORY_TYPE_BY_TARGET_STATUS: Partial<Record<SubscriptionStatus, BillingHistoryEventType>> = {
  active: "payment_succeeded",
  past_due: "payment_failed",
  cancelled: "cancelled",
  expired: "expired",
};

/**
 * Phase 27 — a checkout completing reports a subscription that may be BRAND-NEW (no prior
 * Subscription document at all — a no-trial plan going straight to checkout) or the conversion of
 * an existing LOCAL-ONLY trial (createSubscriptionCore — has no providerSubscriptionId yet) into a
 * real, provider-backed one. The former creates a document; the latter updates the trial's existing
 * document in place (same _id, same trialStart) rather than creating a second one. Either way,
 * reuses the exact same partial-unique-index backstop createSubscriptionCore relies on: if a
 * duplicate/concurrent completion for the same owner races this, the loser is logged and dropped,
 * not a second live subscription.
 */
async function handleCheckoutCompletionEvent(providerName: string, event: ProviderBillingWebhookEvent): Promise<void> {
  const meta = event.checkoutMetadata!;
  const plan = await Plan.findOne({ code: meta.planCode, isActive: true });
  if (!plan) {
    logger.warn("checkout-completion webhook for unknown plan code", { provider: providerName, planCode: meta.planCode });
    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: `Unknown plan code: ${meta.planCode}` } }
    );
    return;
  }

  const provider = getBillingProvider();
  const snapshot = await provider.retrieveSubscription(event.providerSubscriptionId);
  const status: SubscriptionStatus = snapshot.status === "trialing" ? "trialing" : "active";

  const existingLocalTrial = await Subscription.findOne({
    ownerType: meta.ownerType,
    ownerId: meta.ownerId,
    status: { $in: LIVE_STATUSES },
    providerSubscriptionId: { $exists: false },
  });

  let subscription: HydratedDocument<SubscriptionDoc>;
  if (existingLocalTrial) {
    existingLocalTrial.planId = plan._id;
    existingLocalTrial.status = status;
    existingLocalTrial.billingInterval = meta.billingInterval;
    existingLocalTrial.currentPeriodStart = snapshot.currentPeriodStart;
    existingLocalTrial.currentPeriodEnd = snapshot.currentPeriodEnd;
    existingLocalTrial.trialEnd = snapshot.trialEnd ?? existingLocalTrial.trialEnd;
    existingLocalTrial.provider = providerName as SubscriptionDoc["provider"];
    existingLocalTrial.providerCustomerId = meta.providerCustomerId;
    existingLocalTrial.providerSubscriptionId = event.providerSubscriptionId;
    subscription = await existingLocalTrial.save();
  } else {
    try {
      subscription = await Subscription.create({
        ownerType: meta.ownerType,
        ownerId: meta.ownerId,
        planId: plan._id,
        status,
        billingInterval: meta.billingInterval,
        currentPeriodStart: snapshot.currentPeriodStart,
        currentPeriodEnd: snapshot.currentPeriodEnd,
        trialStart: status === "trialing" ? new Date() : undefined,
        trialEnd: snapshot.trialEnd,
        provider: providerName,
        providerCustomerId: meta.providerCustomerId,
        providerSubscriptionId: event.providerSubscriptionId,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        logger.info("duplicate checkout-completion event ignored — owner already has a live subscription", {
          provider: providerName,
          ownerType: meta.ownerType,
          ownerId: meta.ownerId,
        });
        await BillingWebhookEvent.updateOne(
          { provider: providerName, eventId: event.eventId },
          { $set: { processedAt: new Date(), processingError: "Duplicate: owner already has a live subscription" } }
        );
        return;
      }
      throw err;
    }
  }

  const pricing = resolvePricing(plan, meta.billingInterval);
  await recordBillingHistoryEvent({
    ownerType: meta.ownerType,
    ownerId: meta.ownerId,
    subscriptionId: subscription._id,
    type: "subscription_created",
    provider: providerName as SubscriptionDoc["provider"],
    amountCents: pricing?.amountCents,
    currency: pricing?.currency,
    providerReference: event.eventId,
    metadata: { planCode: plan.code, viaCheckout: true },
  });
  if (status === "active") {
    await recordBillingHistoryEvent({
      ownerType: meta.ownerType,
      ownerId: meta.ownerId,
      subscriptionId: subscription._id,
      type: "payment_succeeded",
      provider: providerName as SubscriptionDoc["provider"],
      amountCents: pricing?.amountCents,
      currency: pricing?.currency,
      providerReference: event.eventId,
    });
  }

  await BillingWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
}

/**
 * The single entry point every inbound billing webhook (real or mock-simulated) goes through, for
 * BOTH business and agency subscriptions — the lookup below is keyed by providerSubscriptionId
 * alone, ownerType-agnostic, so no change was needed here for Phase 25. Idempotent by construction,
 * mirroring payment.service.ts's processProviderEvent exactly: the insert into BillingWebhookEvent
 * is the source of truth for "have we seen this event before," not an in-application check. No
 * outbound provider call happens inside this function (unlike refundPayment), so a plain atomic
 * guard is sufficient — no transaction needed for a single-document update.
 *
 * Phase 27 — event.checkoutMetadata present means this is a checkout completing (a subscription
 * being reported for the very first time), routed to handleCheckoutCompletionEvent above instead of
 * the status-transition logic below, which only ever applies to an ALREADY-existing subscription.
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

  if (event.checkoutMetadata) {
    await handleCheckoutCompletionEvent(providerName, event);
    return;
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
  const applied = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: { $ne: targetStatus } },
    { $set: { status: targetStatus, ...(targetStatus === "cancelled" ? { cancelledAt: new Date() } : {}) } },
    { new: true }
  );

  const historyType = HISTORY_TYPE_BY_TARGET_STATUS[targetStatus];
  if (applied && historyType) {
    await recordBillingHistoryEvent({
      ownerType: subscription.ownerType as SubscriptionOwnerType,
      ownerId: subscription.ownerId.toString(),
      subscriptionId: subscription._id,
      type: historyType,
      provider: providerName as SubscriptionDoc["provider"],
      providerReference: event.eventId,
    });
  }

  await BillingWebhookEvent.updateOne({ provider: providerName, eventId: event.eventId }, { $set: { processedAt: new Date() } });
}
