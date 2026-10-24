import type { HydratedDocument } from "mongoose";
import type { BillingHistoryEventType, BillingInterval, SubscriptionOwnerType, SubscriptionStatus } from "@restaurant/types";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { Plan, type PlanDoc } from "../models/Plan.js";
import { BillingWebhookEvent } from "../models/BillingWebhookEvent.js";
import { BillingHistoryEvent } from "../models/BillingHistoryEvent.js";
import { ApiError } from "../utils/ApiError.js";
import { logger } from "../common/logger.js";
import { env } from "../config/env.js";
import { mockDriversAllowed } from "../config/mockDrivers.js";
import { getBillingProvider } from "../billing/index.js";
import type { ProviderBillingWebhookEvent, ProviderCheckoutSession, ProviderSubscriptionStatus } from "../billing/BillingProvider.js";
import { isValidSubscriptionTransition } from "./subscriptionStateMachine.js";
import { recordBillingHistoryEvent } from "./billingHistory.service.js";
import { resolveOwnerIdentity } from "./ownerIdentity.service.js";
import { LIVE_STATUSES } from "./subscriptionResolution.service.js";

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

/**
 * Lane A — a private plan (`isPubliclyListed: false`, e.g. a negotiated client price) is assigned by
 * a platform admin, never picked self-serve: its code must not work for anyone who learns it. A
 * self-serve request may use one only for the subscription that is already on it (e.g. converting
 * an assigned trial through checkout). Same message as an unknown plan, so its existence isn't
 * confirmed either.
 */
function assertSelfServePlan(plan: Pick<PlanDoc, "isPubliclyListed"> & { _id: unknown }, current?: { planId: unknown } | null) {
  if (plan.isPubliclyListed !== false) return;
  if (current && String(current.planId) === String(plan._id)) return;
  throw ApiError.badRequest("Unknown or inactive plan");
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
  billingInterval: BillingInterval,
  { assignedByPlatform = false }: { assignedByPlatform?: boolean } = {}
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
  if (!assignedByPlatform) assertSelfServePlan(plan);

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

  // Phase 89 — a no-card trial charges nothing, so its history row is "trial_started" with no
  // amount (it used to be "subscription_created" carrying the plan price, which read as a payment).
  await recordBillingHistoryEvent({
    ownerType,
    ownerId,
    subscriptionId: subscription._id,
    type: "trial_started",
    provider: subscription.provider,
    metadata: { planCode: plan.code, billingInterval, trialEnd: subscription.trialEnd },
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
  // Phase 85A — the mock provider's checkout "completes" without payment (MockCheckoutPage), so a
  // production deployment that hasn't configured Paddle yet offers trials only, and says so.
  if (getBillingProvider().name === "mock" && !mockDriversAllowed(env.NODE_ENV)) {
    throw ApiError.serviceUnavailable("Paid plan checkout isn't open yet, so nothing can be charged. Your storefront and online ordering keep working either way.");
  }
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

  assertSelfServePlan(plan, existing);

  // Phase 89 — a local-only trial converts on its OWN plan and interval. A client that sent a
  // different one (e.g. a plan picker's default) would otherwise start a checkout — and, on
  // completion, a paid subscription — for a plan the owner never chose. Refused before any
  // provider call; "Change plan" is the way to move a trial to another plan first.
  if (existing?.status === "trialing" && (String(existing.planId) !== String(plan._id) || existing.billingInterval !== billingInterval)) {
    throw ApiError.conflict("Checkout must be for your trial's current plan and billing interval. Change plan first to switch.");
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

/** Lane A — platform-admin assignment (platformSubscription.controller.ts): the same lifecycle as a
 *  self-serve trial, except that a private (unlisted) plan is allowed. */
export async function assignPlanToBusiness(
  businessId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<HydratedDocument<SubscriptionDoc>> {
  return createSubscriptionCore("business", businessId, planCode, billingInterval, { assignedByPlatform: true });
}

export async function assignPlanToAgency(
  agencyId: string,
  planCode: string,
  billingInterval: BillingInterval
): Promise<HydratedDocument<SubscriptionDoc>> {
  return createSubscriptionCore("agency", agencyId, planCode, billingInterval, { assignedByPlatform: true });
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
  const actedAt = new Date();
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
      ...providerActionMarker(subscription, actedAt),
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
  const actedAt = new Date();
  if (subscription.providerSubscriptionId) {
    await provider.reactivateSubscription(subscription.providerSubscriptionId);
  }

  const updated = await Subscription.findOneAndUpdate(
    { _id: subscription._id, status: subscription.status },
    { $set: { status: "active" }, $unset: { cancelAt: "" }, ...providerActionMarker(subscription, actedAt) },
    { new: true }
  );
  if (!updated) throw ApiError.conflict("This subscription was just modified — please retry");

  await recordBillingHistoryEvent({ ownerType, ownerId, subscriptionId: updated._id, type: "reactivated", provider: updated.provider });

  return updated;
}

/**
 * Phase 85A — the provider-hosted "update your card" page for a subscription that has a real
 * provider subscription behind it (e.g. after a failed renewal leaves it past_due). A local-only
 * trial has no card on file yet; adding one is what checkout is for.
 */
async function getPaymentMethodUpdateUrlCore(ownerType: SubscriptionOwnerType, ownerId: string): Promise<string> {
  const subscription = await getLiveSubscriptionOrThrow(ownerType, ownerId);
  if (!subscription.providerSubscriptionId) {
    throw ApiError.badRequest("There's no payment method on file yet — choose a plan to add one.");
  }
  const provider = getBillingProvider();
  if (provider.name !== subscription.provider) {
    throw ApiError.serviceUnavailable("Payment method updates aren't available for this subscription right now.");
  }
  const url = await provider.getPaymentMethodUpdateUrl(subscription.providerSubscriptionId);
  if (!url) throw ApiError.serviceUnavailable("Payment method updates aren't available for this subscription right now.");
  return url;
}

export async function getPaymentMethodUpdateUrl(businessId: string): Promise<string> {
  return getPaymentMethodUpdateUrlCore("business", businessId);
}

export async function getAgencyPaymentMethodUpdateUrl(agencyId: string): Promise<string> {
  return getPaymentMethodUpdateUrlCore("agency", agencyId);
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
  if (plan.type !== EXPECTED_PLAN_TYPE[ownerType]) {
    throw ApiError.badRequest(`This plan is not available for ${OWNER_LABEL[ownerType]} accounts`);
  }
  assertSelfServePlan(plan, subscription);

  const provider = getBillingProvider();
  const actedAt = new Date();
  if (subscription.providerSubscriptionId) {
    // Phase 89 — the provider needs ITS price id for this plan at the subscription's own billing
    // interval, never our plan code (which it can't resolve — every real plan change failed).
    const newPricing = resolvePricing(plan, subscription.billingInterval as BillingInterval);
    if (!newPricing?.providerPriceId) {
      throw ApiError.badRequest(`The ${plan.name} plan has no ${subscription.billingInterval} price configured with the billing provider yet`);
    }
    await provider.changePlan(subscription.providerSubscriptionId, newPricing.providerPriceId);
  }

  subscription.planId = plan._id;
  // Phase 89 — see providerActionMarker: an older provider event must not undo this change.
  if (subscription.providerSubscriptionId && (!subscription.lastProviderEventAt || subscription.lastProviderEventAt < actedAt)) {
    subscription.lastProviderEventAt = actedAt;
  }
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
function resolveTransitionTarget(
  currentStatus: SubscriptionStatus,
  providerStatus: ProviderSubscriptionStatus,
  scheduledCancelAt?: Date | null
): SubscriptionStatus {
  if (providerStatus === "cancelled" && currentStatus === "trialing") return "expired";
  // Phase 89 — Paddle keeps reporting "active" for a subscription whose cancellation is scheduled
  // for period end; that is our "cancelling", not a reactivation (which this used to apply). Only
  // an event that says NO cancellation is scheduled (null) un-cancels.
  if (providerStatus === "active" && scheduledCancelAt) return "cancelling";
  return providerStatus;
}

const HISTORY_TYPE_BY_NOTICE: Record<NonNullable<ProviderBillingWebhookEvent["billingNotice"]>["type"], BillingHistoryEventType> = {
  payment_succeeded: "payment_succeeded",
  refunded: "refunded",
  chargeback: "chargeback",
  chargeback_reversed: "chargeback_reversed",
};

/**
 * Phase 89 — event ordering. Subscription.lastProviderEventAt is the time of the newest SUBSCRIPTION
 * state the record reflects: a subscription.* event's occurred_at, or the moment an in-app action
 * (cancel/reactivate/plan change) called the provider. Only subscription events advance it or are
 * judged by it — transaction/adjustment events report payments, not subscription state, so they never
 * touch it (one arriving first must not make the matching subscription update look "old"). Every
 * write a subscription event makes is guarded by this filter, so an older event — even one racing a
 * newer one — can't overwrite newer status, dates, cancellation or plan.
 */
function notOlderThanApplied(occurredAt: Date | undefined): Record<string, unknown> {
  return occurredAt ? { $or: [{ lastProviderEventAt: { $exists: false } }, { lastProviderEventAt: { $lte: occurredAt } }] } : {};
}

/** In-app provider actions record when they acted (only ever forward), so a provider event that
 *  happened BEFORE the action but arrives after it can't undo it. Local-only subscriptions skip it. */
function providerActionMarker(subscription: Pick<SubscriptionDoc, "providerSubscriptionId">, actedAt: Date): Record<string, unknown> {
  return subscription.providerSubscriptionId ? { $max: { lastProviderEventAt: actedAt } } : {};
}

/**
 * Phase 89 — renewals and outside changes. A subscription event can carry the current billing
 * period, a scheduled cancellation date, and the price it's on now; until this phase only the status
 * was read, so period dates froze at checkout. Returns the subscription as it stands after claiming
 * this event's place in the order, or null when a newer subscription event (or in-app action) is
 * already applied — the caller then changes nothing else either.
 */
async function applyProviderSubscriptionDetails(
  subscription: HydratedDocument<SubscriptionDoc>,
  event: ProviderBillingWebhookEvent
): Promise<HydratedDocument<SubscriptionDoc> | null> {
  let current = subscription;
  if (event.occurredAt) {
    const claimed = await Subscription.findOneAndUpdate(
      { _id: subscription._id, ...notOlderThanApplied(event.occurredAt) },
      { $set: { lastProviderEventAt: event.occurredAt } },
      { new: true }
    );
    if (!claimed) {
      logger.info("older subscription webhook event — not applied (a newer state is already recorded)", {
        subscriptionId: subscription.id,
        eventId: event.eventId,
      });
      return null;
    }
    current = claimed;
  }

  const set: Record<string, unknown> = {};
  let planChange: { code: string; amountCents?: number | null; currency?: string | null } | null = null;
  if (event.currentPeriod) {
    set.currentPeriodStart = event.currentPeriod.start;
    set.currentPeriodEnd = event.currentPeriod.end;
  }
  if (event.scheduledCancelAt) set.cancelAt = event.scheduledCancelAt;
  if (event.providerPriceId) {
    const plan = await Plan.findOne({ "pricing.providerPriceId": event.providerPriceId });
    const pricing = plan?.pricing.find((p) => p.providerPriceId === event.providerPriceId);
    if (!plan || !pricing) {
      logger.warn("billing webhook reports a price no local plan maps to — plan left unchanged", {
        subscriptionId: current.id,
        providerPriceId: event.providerPriceId,
      });
    } else if (!plan._id.equals(current.planId) || pricing.interval !== current.billingInterval) {
      set.planId = plan._id;
      set.billingInterval = pricing.interval;
      planChange = { code: plan.code, amountCents: pricing.amountCents, currency: pricing.currency };
    }
  }
  if (!Object.keys(set).length) return current;

  const updated = await Subscription.findOneAndUpdate({ _id: current._id, ...notOlderThanApplied(event.occurredAt) }, { $set: set }, { new: true });
  if (!updated) return null; // a newer event claimed the order between our claim and this write
  if (planChange) {
    await recordBillingHistoryEvent({
      ownerType: updated.ownerType as SubscriptionOwnerType,
      ownerId: updated.ownerId.toString(),
      subscriptionId: updated._id,
      type: "plan_changed",
      provider: updated.provider,
      amountCents: planChange.amountCents ?? undefined,
      currency: planChange.currency ?? undefined,
      providerReference: event.eventId,
      metadata: { newPlanCode: planChange.code, viaProvider: true },
    });
  }
  return updated;
}

/** Phase 89 — renewal payments, refunds and chargebacks: a billing-history row only. Deliberately
 *  never changes status or access — whether a refund or chargeback should end access is a business
 *  decision this code doesn't make; the row (and the warning log for chargebacks) makes it visible.
 *  Paddle reports one adjustment on both .created and .updated, so a row already recorded for the
 *  same provider reference is not recorded twice. */
async function recordProviderBillingNotice(subscription: HydratedDocument<SubscriptionDoc>, event: ProviderBillingWebhookEvent): Promise<void> {
  const notice = event.billingNotice!;
  const type = HISTORY_TYPE_BY_NOTICE[notice.type];
  const reference = notice.reference ?? event.eventId;
  const noticeKey = `${type}:${reference}`;
  // Fast path for the common sequential redelivery; the unique (subscriptionId, noticeKey) index is
  // what actually guarantees one row when two deliveries race (recordBillingHistoryEvent ignores
  // the duplicate-key error).
  if (await BillingHistoryEvent.exists({ subscriptionId: subscription._id, noticeKey })) return;
  if (notice.type === "chargeback") {
    logger.warn("chargeback reported for subscription — review the account", { subscriptionId: subscription.id, reference });
  }
  await recordBillingHistoryEvent({
    ownerType: subscription.ownerType as SubscriptionOwnerType,
    ownerId: subscription.ownerId.toString(),
    subscriptionId: subscription._id,
    type,
    provider: subscription.provider,
    amountCents: notice.amountCents,
    currency: notice.currency,
    providerReference: reference,
    occurredAt: event.occurredAt,
    noticeKey,
  });
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
    // Deliberately left retryable (processedAt NOT set, processingStartedAt cleared): if this is a
    // real transient data-consistency issue (e.g. a plan momentarily deactivated) rather than a
    // permanent mismatch, a later retry of the identical event should still get a fair chance.
    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: `Unknown plan code: ${meta.planCode}` }, $unset: { processingStartedAt: "" } }
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
    // Phase 89 — a subscription the provider reports as active is no longer in a trial: clear the
    // local trial's end date instead of carrying it over (it read as a live trial in admin views).
    existingLocalTrial.trialEnd = status === "trialing" ? (snapshot.trialEnd ?? existingLocalTrial.trialEnd) : undefined;
    existingLocalTrial.provider = providerName as SubscriptionDoc["provider"];
    existingLocalTrial.providerCustomerId = meta.providerCustomerId;
    existingLocalTrial.providerSubscriptionId = event.providerSubscriptionId;
    if (event.occurredAt) existingLocalTrial.lastProviderEventAt = event.occurredAt; // Phase 89 — event ordering
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
        lastProviderEventAt: event.occurredAt, // Phase 89 — event ordering
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
          {
            $set: { processedAt: new Date(), processingError: "Duplicate: owner already has a live subscription" },
            $unset: { processingStartedAt: "" },
          }
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

  await BillingWebhookEvent.updateOne(
    { provider: providerName, eventId: event.eventId },
    { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "", processingError: "" } }
  );
}

/**
 * Phase 40.1 — the atomic claim mechanism that closes a real gap Phase 40's live Paddle
 * verification found: the OLD logic (a plain `BillingWebhookEvent.create()`, treating any
 * duplicate-key error as "already handled") could not tell "genuinely already processed" apart from
 * "a prior attempt's marker exists, but that attempt failed before finishing" — a transient failure
 * partway through (e.g. `retrieveSubscription()` timing out) would permanently swallow every future
 * retry of the identical event as a false duplicate, silently losing a real checkout forever.
 *
 * Two-step, reusing this codebase's own established atomic-guard pattern (reserveLocationSlot/
 * reserveBusinessSlot: a single findOneAndUpdate with the condition IN the filter, never
 * check-then-act):
 *
 * 1. Try the plain insert first — for a BRAND NEW event, this is the same atomic guard as before,
 *    unchanged: the unique {provider,eventId} index lets at most one concurrent insert win.
 * 2. If that insert loses to a duplicate-key error, a marker already exists. Attempt to atomically
 *    CLAIM it via findOneAndUpdate, matching only a record with BOTH `processedAt` and
 *    `processingStartedAt` unset — a document that's either brand new (impossible here, since we
 *    just failed to insert it) or, critically, one whose only prior attempt failed and cleared
 *    `processingStartedAt` on the way out (see the try/catch below). Only one of any number of truly
 *    concurrent claim attempts can win this — the update is what makes it exclusive, not the filter
 *    alone: the loser's identical filter fails to match once the winner's write lands.
 *
 * Returns `true` (proceed to process) only when this call was the one that actually won a claim —
 * either the original insert or the retry-claim. Returns `false` for every other case: a genuinely
 * concurrent in-flight duplicate (someone else currently holds the claim), or a truly
 * already-completed event (`processedAt` set) — both correctly a silent no-op, exactly matching the
 * pre-existing, still-tested "duplicate ignored" behavior for those two cases specifically.
 */
async function claimWebhookEventForProcessing(providerName: string, event: ProviderBillingWebhookEvent): Promise<boolean> {
  try {
    await BillingWebhookEvent.create({
      provider: providerName,
      eventId: event.eventId,
      eventType: event.eventType,
      payload: event.raw,
      processingStartedAt: new Date(),
    });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code !== 11000) throw err;
  }

  const claimed = await BillingWebhookEvent.findOneAndUpdate(
    { provider: providerName, eventId: event.eventId, processedAt: { $exists: false }, processingStartedAt: { $exists: false } },
    { $set: { processingStartedAt: new Date() } },
    { new: true }
  );
  if (claimed) {
    logger.info("retrying a previously-stuck billing webhook event whose earlier attempt never finished", {
      provider: providerName,
      eventId: event.eventId,
    });
    return true;
  }

  logger.info("duplicate billing webhook event ignored — already processed or a concurrent delivery is in flight", {
    provider: providerName,
    eventId: event.eventId,
  });
  return false;
}

/** Phase 89 — how long an event for a not-yet-recorded subscription keeps asking to be retried.
 *  Covers Paddle's sandbox schedule (3 retries within 15 minutes) and the first live retries; the
 *  out-of-order case it exists for resolves within seconds. */
export const UNKNOWN_REFERENCE_RETRY_WINDOW_MS = 15 * 60 * 1000;

/** Phase 89 — recorded on a provider-simulator event (see processBillingProviderEvent). */
export const SIMULATED_EVENT_IGNORED = "Ignored: provider simulator event — not applied";

function isRetryableUnknownReference(event: ProviderBillingWebhookEvent, now = Date.now()): boolean {
  if (!event.providerSubscriptionId || !event.occurredAt) return false;
  // Nothing to apply (e.g. a first-payment transaction.completed) — retrying would gain nothing.
  if (!event.status && !event.billingNotice) return false;
  return now - event.occurredAt.getTime() < UNKNOWN_REFERENCE_RETRY_WINDOW_MS;
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
 *
 * Phase 40.1 — everything from the claim onward is wrapped in try/catch: an uncaught throw (e.g. a
 * transient failure in handleCheckoutCompletionEvent's real provider.retrieveSubscription() call)
 * now clears processingStartedAt and records processingError, leaving the event genuinely retryable
 * on the next delivery, then re-throws so the HTTP layer still returns a non-2xx — the correct
 * signal for a real provider's own retry mechanism to actually retry.
 */
export async function processBillingProviderEvent(providerName: string, event: ProviderBillingWebhookEvent): Promise<void> {
  const claimed = await claimWebhookEventForProcessing(providerName, event);
  if (!claimed) return;

  try {
    // Phase 89 — a provider-simulator event is correctly signed and may carry a real subscription's
    // data, but nothing happened: applying it could advance a period or record a payment that was
    // never charged. It is acknowledged and recorded (a repeat stays a no-op through the claim
    // above), never applied — before any branch below, including checkout completion.
    if (event.simulated) {
      logger.info("billing webhook simulator event recorded, not applied", {
        provider: providerName,
        eventType: event.eventType,
        eventId: event.eventId,
      });
      await BillingWebhookEvent.updateOne(
        { provider: providerName, eventId: event.eventId },
        { $set: { processedAt: new Date(), processingError: SIMULATED_EVENT_IGNORED }, $unset: { processingStartedAt: "" } }
      );
      return;
    }

    if (event.checkoutMetadata) {
      await handleCheckoutCompletionEvent(providerName, event);
      return;
    }

    const markProcessed = () =>
      BillingWebhookEvent.updateOne(
        { provider: providerName, eventId: event.eventId },
        { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "", processingError: "" } }
      );

    const subscription = event.providerSubscriptionId
      ? await Subscription.findOne({ provider: providerName, providerSubscriptionId: event.providerSubscriptionId })
      : null;
    if (!subscription) {
      // Phase 89 — Paddle does not guarantee delivery order: subscription.activated can arrive
      // while subscription.created (which links the reference) is still being processed. A recent
      // event that would change something is therefore answered with a retryable error (the catch
      // below clears the claim; the HTTP layer returns 503; Paddle retries) instead of being
      // consumed. Older or no-op events for unknown references are still recorded and ignored, so
      // a genuinely foreign reference never retries for days.
      if (isRetryableUnknownReference(event)) {
        logger.warn("billing webhook event for a subscription not recorded yet — asking the provider to retry", {
          provider: providerName,
          eventType: event.eventType,
          providerSubscriptionId: event.providerSubscriptionId,
        });
        throw ApiError.serviceUnavailable("Subscription not recorded yet — retry later.");
      }
      if (event.providerSubscriptionId) {
        logger.warn("billing webhook event for unknown subscription reference", {
          provider: providerName,
          providerSubscriptionId: event.providerSubscriptionId,
        });
      }
      await markProcessed();
      return;
    }

    // Phase 89 — transaction/adjustment events: a billing-history notice at most. They carry no
    // subscription status and never touch the subscription's event ordering.
    if (!event.status) {
      if (event.billingNotice) await recordProviderBillingNotice(subscription, event);
      await markProcessed();
      return;
    }

    const current = await applyProviderSubscriptionDetails(subscription, event);
    if (!current) {
      await BillingWebhookEvent.updateOne(
        { provider: providerName, eventId: event.eventId },
        { $set: { processedAt: new Date(), processingError: "Ignored: older than the subscription state already applied" }, $unset: { processingStartedAt: "" } }
      );
      return;
    }

    const targetStatus = resolveTransitionTarget(current.status, event.status, event.scheduledCancelAt);
    // Phase 89 — most subscription.updated events (plan changes, renewals) don't change the status.
    // Their details were applied just above; an unchanged status is a normal no-op, not an invalid
    // transition (the shared state machine has no self-transitions because in-app actions must
    // still refuse e.g. reactivating an already-active subscription).
    if (targetStatus === current.status) {
      await markProcessed();
      return;
    }
    if (!isValidSubscriptionTransition(current.status, targetStatus)) {
      logger.warn("ignored invalid subscription status transition from webhook", {
        subscriptionId: current.id,
        from: current.status,
        to: targetStatus,
      });
      await BillingWebhookEvent.updateOne(
        { provider: providerName, eventId: event.eventId },
        { $set: { processedAt: new Date(), processingError: `Ignored: ${current.status} -> ${targetStatus}` }, $unset: { processingStartedAt: "" } }
      );
      return;
    }

    // Guarded by the status it was read with, so a race between two deliveries of the same
    // real-world transition can't apply it twice, and (Phase 89) by the event order, so a newer
    // subscription event that landed meanwhile always wins.
    const applied = await Subscription.findOneAndUpdate(
      { _id: current._id, status: current.status, ...notOlderThanApplied(event.occurredAt) },
      {
        $set: { status: targetStatus, ...(targetStatus === "cancelled" ? { cancelledAt: new Date() } : {}) },
        // Un-cancelled at the provider (cancelling -> active): the scheduled end date no longer
        // applies. Phase 89 — and an active subscription is no longer in a trial.
        ...(targetStatus === "active"
          ? { $unset: { trialEnd: "", ...(current.status === "cancelling" ? { cancelAt: "" } : {}) } }
          : {}),
      },
      { new: true }
    );

    // Phase 89 — a provider-side un-cancel or scheduled cancel is not a payment.
    const historyType =
      current.status === "cancelling" && targetStatus === "active"
        ? "reactivated"
        : targetStatus === "cancelling"
          ? "cancellation_requested"
          : HISTORY_TYPE_BY_TARGET_STATUS[targetStatus];
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

    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processedAt: new Date() }, $unset: { processingStartedAt: "", processingError: "" } }
    );
  } catch (err) {
    await BillingWebhookEvent.updateOne(
      { provider: providerName, eventId: event.eventId },
      { $set: { processingError: (err as Error).message }, $unset: { processingStartedAt: "" } }
    );
    throw err;
  }
}

/**
 * Phase 63 — the autonomous mechanism this codebase was missing entirely. Before this phase, the
 * ONLY thing that ever transitioned a `"trialing"` subscription to `"expired"` was a real billing
 * provider's webhook reporting the trial ended unconverted (resolveTransitionTarget above) — a
 * trigger that has never fired once, in any environment, since no environment has ever had a live,
 * connected provider. That meant every trial silently stayed `"trialing"` — a LIVE status carrying
 * full plan entitlements — forever, regardless of how much real time had actually passed.
 *
 * entitlementLimit.service.ts's/agencyEntitlement.service.ts's own real-time boundary check
 * (subscriptionResolution.service.ts's isSubscriptionLive) already makes entitlement/capacity
 * DECISIONS correct the instant a trial's `trialEnd` passes, independent of this job's cadence — so
 * this sweep is not itself the source of correctness. Its job is to eventually persist
 * `status: "expired"` on the document too, so billing history, the admin/billing-page display, and
 * any other code that reads `status` directly (rather than through the boundary-aware resolver) also
 * reflects reality — and so a real, later provider webhook transition finds the expected prior state
 * instead of a permanently-stale `"trialing"`.
 *
 * Registered as a repeatable job (registerTrialExpirationJob, notification.queue.ts) — mirrors
 * runTrialEndingReminderSweep's exact shape: a plain query for candidates, then one atomic
 * findOneAndUpdate per candidate guarded by `status: "trialing"` in the filter (not a check-then-
 * write), so a real concurrent conversion or cancellation racing this sweep can never be clobbered —
 * whichever one lands first wins, and the sweep silently skips anything it no longer matches.
 */
export async function runTrialExpirationSweep(): Promise<void> {
  const now = new Date();
  const candidates = await Subscription.find({
    status: "trialing",
    trialEnd: { $lte: now },
    provider: { $ne: "internal" },
  }).select("_id");

  for (const candidate of candidates) {
    const updated = await Subscription.findOneAndUpdate(
      { _id: candidate._id, status: "trialing" },
      { $set: { status: "expired" } },
      { new: true }
    );
    if (!updated) continue; // a real conversion/cancellation/reactivation already moved this one

    await recordBillingHistoryEvent({
      ownerType: updated.ownerType as SubscriptionOwnerType,
      ownerId: updated.ownerId.toString(),
      subscriptionId: updated._id,
      type: "expired",
      provider: updated.provider,
    });
  }
}
