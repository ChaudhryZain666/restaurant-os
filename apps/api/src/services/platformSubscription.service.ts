import type { HydratedDocument } from "mongoose";
import type {
  ManualBillingKind,
  PlatformSubscriptionSummary,
  SubscriptionBillingSource,
  SubscriptionOwnerType,
  SubscriptionStatus,
} from "@restaurant/types";
import type {
  AdminCancelSubscriptionInput,
  ChangeManualSubscriptionPlanInput,
  CreateManualSubscriptionInput,
  ExtendManualSubscriptionInput,
} from "@restaurant/validation";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { Plan, type PlanDoc } from "../models/Plan.js";
import { ApiError } from "../utils/ApiError.js";
import { recordBillingHistoryEvent } from "./billingHistory.service.js";
import { resolveOwnerIdentity } from "./ownerIdentity.service.js";
import { isSubscriptionLive, LIVE_STATUSES } from "./subscriptionResolution.service.js";
import { isValidSubscriptionTransition } from "./subscriptionStateMachine.js";
import { cancelSubscription, cancelAgencySubscription, expireLapsedManualSubscriptions, resolvePricing } from "./subscription.service.js";

/**
 * Platform-admin subscriptions — a plan assigned directly by GarnishTable staff, without checkout.
 *
 * Stored as `provider: "manual"`: no billing provider is ever called for one, no provider ids are
 * ever set, and no payment, invoice or provider transaction is ever recorded. `manualBilling` holds
 * the agreement (complimentary, or paid offline at an agreed — possibly negotiated — price per
 * interval), for display and revenue reporting only. Unlike the grandfathered "internal" provider
 * it is enforced like any plan: its entitlements apply, it ends at `currentPeriodEnd` unless
 * extended (isSubscriptionLive / expireLapsedManualSubscriptions), and a suspension ends access.
 *
 * The owner's own billing actions refuse a manual subscription (subscription.service.ts's
 * assertNotPlatformManaged), and checkout can never convert one. Every change goes through here,
 * reached only from platform_admin routes; the controller records the audit trail.
 */

/** Longest single term an admin can set, from now. */
const MAX_TERM_MS = 5 * 366 * 24 * 60 * 60 * 1000;
/** Tolerates clock skew between the admin's browser and the server for "starts now". */
const START_SKEW_MS = 5 * 60 * 1000;

const OWNER_LABEL: Record<SubscriptionOwnerType, string> = { business: "business", agency: "agency" };
const EXPECTED_PLAN_TYPE: Record<SubscriptionOwnerType, "OWNER" | "AGENCY"> = { business: "OWNER", agency: "AGENCY" };

const SOURCE_LABEL: Record<SubscriptionBillingSource, string> = {
  trial: "a free trial",
  lemonsqueezy: "a Lemon Squeezy subscription",
  paddle: "a Paddle subscription",
  mock: "a development-billing subscription",
  manual_offline: "a manual (offline-billed) subscription",
  complimentary: "a complimentary subscription",
  internal: "a grandfathered account",
};

export function billingSourceOf(sub: Pick<SubscriptionDoc, "provider" | "status" | "providerSubscriptionId" | "manualBilling">): SubscriptionBillingSource {
  if (sub.provider === "manual") return sub.manualBilling?.kind === "complimentary" ? "complimentary" : "manual_offline";
  if (sub.provider === "internal") return "internal";
  if (sub.status === "trialing" && !sub.providerSubscriptionId) return "trial";
  return sub.provider as "lemonsqueezy" | "paddle" | "mock";
}

/** The admin-facing view of a subscription. Provider customer/subscription ids are an external
 *  system's internal references and are never included. */
export function toPlatformSubscriptionSummary(
  sub: HydratedDocument<SubscriptionDoc>,
  plan: Pick<PlanDoc, "code" | "name"> | null,
  now: Date = new Date()
): PlatformSubscriptionSummary {
  return {
    id: sub.id as string,
    status: sub.status as SubscriptionStatus,
    isLive: isSubscriptionLive(sub, now),
    billingSource: billingSourceOf(sub),
    billingInterval: sub.billingInterval,
    currentPeriodStart: sub.currentPeriodStart.toISOString(),
    currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
    trialEnd: sub.trialEnd?.toISOString() ?? null,
    cancelAt: sub.cancelAt?.toISOString() ?? null,
    provider: sub.provider,
    planCode: plan?.code ?? null,
    planName: plan?.name ?? null,
    manualBilling: sub.manualBilling
      ? {
          kind: sub.manualBilling.kind as ManualBillingKind,
          amountCents: sub.manualBilling.amountCents,
          currency: sub.manualBilling.currency,
          ...(sub.manualBilling.note ? { note: sub.manualBilling.note } : {}),
        }
      : null,
    suspendedAt: sub.suspendedAt?.toISOString() ?? null,
    suspendedReason: sub.suspendedReason ?? null,
  };
}

async function findAssignablePlan(ownerType: SubscriptionOwnerType, planCode: string) {
  const plan = await Plan.findOne({ code: planCode, isActive: true });
  if (!plan) throw ApiError.badRequest("Unknown or inactive plan");
  if (plan.type !== EXPECTED_PLAN_TYPE[ownerType]) {
    throw ApiError.badRequest(`This plan is not available for ${OWNER_LABEL[ownerType]} accounts`);
  }
  return plan;
}

/** The agreed terms: complimentary is always 0; offline defaults to the plan's own price for the
 *  interval and may be overridden with a negotiated one. */
function agreedTerms(plan: HydratedDocument<PlanDoc>, billingInterval: "monthly" | "yearly", kind: ManualBillingKind, amountCents?: number) {
  const pricing = resolvePricing(plan, billingInterval);
  const currency = pricing?.currency ?? "USD";
  if (kind === "complimentary") return { amountCents: 0, currency };
  const amount = amountCents ?? pricing?.amountCents ?? undefined;
  if (amount === undefined || amount === null) {
    throw ApiError.badRequest(`The ${plan.name} plan has no ${billingInterval} price — enter the agreed price`);
  }
  // A $0 "offline" plan would read as billed while earning nothing — that is a complimentary plan.
  if (amount <= 0) throw ApiError.badRequest("An offline-billed plan needs a price above zero — use complimentary for a free plan");
  return { amountCents: amount, currency };
}

function parseTerm(startsAtIso: string | undefined, endsAtIso: string, now: Date) {
  const startsAt = startsAtIso ? new Date(startsAtIso) : now;
  const endsAt = new Date(endsAtIso);
  if (startsAt.getTime() > now.getTime() + START_SKEW_MS) {
    throw ApiError.badRequest("A subscription can't start in the future — create it on its start date");
  }
  assertEndDate(endsAt, startsAt, now);
  return { startsAt, endsAt };
}

function assertEndDate(endsAt: Date, after: Date, now: Date) {
  if (endsAt.getTime() <= now.getTime()) throw ApiError.badRequest("The end date must be in the future");
  if (endsAt.getTime() <= after.getTime()) throw ApiError.badRequest("The end date must be after the start date");
  if (endsAt.getTime() > now.getTime() + MAX_TERM_MS) throw ApiError.badRequest("The end date can be at most five years from today");
}

async function loadManual(subscriptionId: string) {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) throw ApiError.notFound("Subscription not found");
  await expireLapsedManualSubscriptions({ ownerType: sub.ownerType as SubscriptionOwnerType, ownerId: sub.ownerId.toString() });
  const fresh = await Subscription.findById(subscriptionId);
  if (!fresh) throw ApiError.notFound("Subscription not found");
  return fresh;
}

function assertManual(sub: HydratedDocument<SubscriptionDoc>, action: string) {
  if (sub.provider !== "manual") {
    throw ApiError.conflict(
      `Only a manual or complimentary subscription can be ${action} here — this is ${SOURCE_LABEL[billingSourceOf(sub)]}.`
    );
  }
}

function assertStatus(sub: HydratedDocument<SubscriptionDoc>, allowed: SubscriptionStatus[], action: string) {
  if (!allowed.includes(sub.status as SubscriptionStatus)) {
    throw ApiError.conflict(`A ${sub.status} subscription can't be ${action}`);
  }
}

/** The write itself, guarded by the state it was read in so two admins can't interleave. */
async function guardedUpdate(sub: HydratedDocument<SubscriptionDoc>, update: Record<string, unknown>) {
  const updated = await Subscription.findOneAndUpdate(
    { _id: sub._id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, planId: sub.planId },
    update,
    { new: true }
  );
  if (!updated) throw ApiError.conflict("This subscription was just changed — reload and try again");
  return updated;
}

export async function createManualSubscription(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  input: CreateManualSubscriptionInput,
  actorUserId: string,
  now: Date = new Date()
): Promise<HydratedDocument<SubscriptionDoc>> {
  const identity = await resolveOwnerIdentity(ownerType, ownerId);
  if (!identity) throw ApiError.notFound(`${ownerType === "business" ? "Business" : "Agency"} not found`);

  const plan = await findAssignablePlan(ownerType, input.planCode);
  const terms = agreedTerms(plan, input.billingInterval, input.kind, input.amountCents);
  const { startsAt, endsAt } = parseTerm(input.startsAt, input.endsAt, now);
  const manualBilling = {
    kind: input.kind,
    amountCents: terms.amountCents,
    currency: terms.currency,
    ...(input.note ? { note: input.note } : {}),
    createdByUserId: actorUserId,
  };

  await expireLapsedManualSubscriptions({ ownerType, ownerId }, now);
  const existing = await Subscription.findOne({ ownerType, ownerId, status: { $in: LIVE_STATUSES } });

  let subscription: HydratedDocument<SubscriptionDoc>;
  let convertedFromTrial = false;
  if (existing) {
    // A no-card trial (nothing paid, no provider behind it) is converted in place — the same way a
    // checkout converts one. Anything else is a real commitment: change, extend or cancel it first.
    const isLocalTrial = existing.status === "trialing" && !existing.providerSubscriptionId && existing.provider !== "manual";
    if (!isLocalTrial) {
      throw ApiError.conflict(
        `This ${OWNER_LABEL[ownerType]} already has ${SOURCE_LABEL[billingSourceOf(existing)]} (${existing.status}). Change, extend or cancel it instead.`
      );
    }
    const updated = await Subscription.findOneAndUpdate(
      { _id: existing._id, status: "trialing", providerSubscriptionId: { $exists: false } },
      {
        $set: {
          planId: plan._id,
          status: "active",
          billingInterval: input.billingInterval,
          currentPeriodStart: startsAt,
          currentPeriodEnd: endsAt,
          provider: "manual",
          manualBilling,
        },
        $unset: { trialEnd: "", trialExtension: "", trialEndingReminderSentAt: "" },
      },
      { new: true }
    );
    if (!updated) throw ApiError.conflict("This subscription was just changed — reload and try again");
    subscription = updated;
    convertedFromTrial = true;
  } else {
    try {
      subscription = await Subscription.create({
        ownerType,
        ownerId,
        planId: plan._id,
        status: "active",
        billingInterval: input.billingInterval,
        currentPeriodStart: startsAt,
        currentPeriodEnd: endsAt,
        provider: "manual",
        manualBilling,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        throw ApiError.conflict(`This ${OWNER_LABEL[ownerType]} already has an active subscription`);
      }
      throw err;
    }
  }

  // An agreement, not a payment: no amountCents on the row (that field reads as money moved).
  await recordBillingHistoryEvent({
    ownerType,
    ownerId,
    subscriptionId: subscription._id,
    type: "subscription_created",
    provider: "manual",
    metadata: {
      source: "platform_admin",
      kind: input.kind,
      planCode: plan.code,
      billingInterval: input.billingInterval,
      agreedAmountCents: terms.amountCents,
      currency: terms.currency,
      startsAt,
      endsAt,
      ...(convertedFromTrial ? { convertedFromTrial: true } : {}),
    },
  });
  return subscription;
}

export async function extendManualSubscription(
  subscriptionId: string,
  input: ExtendManualSubscriptionInput,
  now: Date = new Date()
): Promise<{ subscription: HydratedDocument<SubscriptionDoc>; previousEnd: Date }> {
  const sub = await loadManual(subscriptionId);
  assertManual(sub, "extended");
  assertStatus(sub, ["active"], "extended (resume it first if it is set to cancel)");
  const endsAt = new Date(input.endsAt);
  assertEndDate(endsAt, sub.currentPeriodEnd, now);

  const previousEnd = sub.currentPeriodEnd;
  // Admin notes live only on the terms (admin-only); history and audit rows are owner-visible.
  const updated = await guardedUpdate(sub, { $set: { currentPeriodEnd: endsAt, ...(input.note ? { "manualBilling.note": input.note } : {}) } });
  await recordBillingHistoryEvent({
    ownerType: updated.ownerType as SubscriptionOwnerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: "subscription_extended",
    provider: "manual",
    metadata: { from: previousEnd, to: endsAt },
  });
  return { subscription: updated, previousEnd };
}

export async function changeManualSubscriptionPlan(
  subscriptionId: string,
  input: ChangeManualSubscriptionPlanInput
): Promise<{ subscription: HydratedDocument<SubscriptionDoc>; previousPlanCode: string | null }> {
  const sub = await loadManual(subscriptionId);
  assertManual(sub, "changed");
  assertStatus(sub, ["active"], "changed");
  const ownerType = sub.ownerType as SubscriptionOwnerType;
  const plan = await findAssignablePlan(ownerType, input.planCode);
  const kind = (sub.manualBilling?.kind ?? "offline") as ManualBillingKind;
  const terms = agreedTerms(plan, input.billingInterval, kind, input.amountCents);
  const previousPlan = await Plan.findById(sub.planId).select("code");

  const updated = await guardedUpdate(sub, {
    $set: {
      planId: plan._id,
      billingInterval: input.billingInterval,
      "manualBilling.amountCents": terms.amountCents,
      "manualBilling.currency": terms.currency,
      ...(input.note ? { "manualBilling.note": input.note } : {}),
    },
  });
  await recordBillingHistoryEvent({
    ownerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: "plan_changed",
    provider: "manual",
    metadata: {
      source: "platform_admin",
      fromPlanCode: previousPlan?.code ?? null,
      newPlanCode: plan.code,
      billingInterval: input.billingInterval,
      agreedAmountCents: terms.amountCents,
      currency: terms.currency,
    },
  });
  return { subscription: updated, previousPlanCode: previousPlan?.code ?? null };
}

export async function suspendManualSubscription(subscriptionId: string, reason: string, now: Date = new Date()) {
  const sub = await loadManual(subscriptionId);
  assertManual(sub, "suspended");
  assertStatus(sub, ["active", "cancelling"], "suspended");
  if (sub.suspendedAt) throw ApiError.conflict("This subscription is already suspended");
  const updated = await guardedUpdate(sub, { $set: { suspendedAt: now, suspendedReason: reason } });
  await recordBillingHistoryEvent({
    ownerType: updated.ownerType as SubscriptionOwnerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: "suspended",
    provider: "manual",
    metadata: { reason },
  });
  return updated;
}

export async function unsuspendManualSubscription(subscriptionId: string) {
  const sub = await loadManual(subscriptionId);
  assertManual(sub, "unsuspended");
  if (!sub.suspendedAt) throw ApiError.conflict("This subscription isn't suspended");
  assertStatus(sub, ["active", "cancelling"], "unsuspended");
  const updated = await guardedUpdate(sub, { $unset: { suspendedAt: "", suspendedReason: "" } });
  await recordBillingHistoryEvent({
    ownerType: updated.ownerType as SubscriptionOwnerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: "reactivated",
    provider: "manual",
    metadata: { from: "suspended" },
  });
  return updated;
}

/** Brings a manual subscription that is set to cancel back to active (same as an owner un-cancelling). */
export async function resumeManualSubscription(subscriptionId: string) {
  const sub = await loadManual(subscriptionId);
  assertManual(sub, "resumed");
  assertStatus(sub, ["cancelling"], "resumed");
  const updated = await guardedUpdate(sub, { $set: { status: "active" }, $unset: { cancelAt: "" } });
  await recordBillingHistoryEvent({
    ownerType: updated.ownerType as SubscriptionOwnerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: "reactivated",
    provider: "manual",
    metadata: { from: "cancelling" },
  });
  return updated;
}

/**
 * Cancels any live subscription as a platform admin.
 *  - Manual: immediately, or at the end of its current term.
 *  - Anything else goes through the owner's own cancellation lifecycle (subscription.service.ts),
 *    so a provider-paid subscription is cancelled at the provider and keeps its paid period — it is
 *    never ended "immediately" here, because that would end access the customer has paid for
 *    while the provider still considers it running.
 */
export async function adminCancelSubscription(
  subscriptionId: string,
  input: AdminCancelSubscriptionInput,
  now: Date = new Date()
): Promise<HydratedDocument<SubscriptionDoc>> {
  const sub = await loadManual(subscriptionId);
  if (!LIVE_STATUSES.includes(sub.status as SubscriptionStatus)) {
    throw ApiError.conflict(`A ${sub.status} subscription can't be cancelled`);
  }

  if (sub.provider !== "manual") {
    if (input.when === "immediately" && sub.providerSubscriptionId) {
      throw ApiError.badRequest("A provider-paid subscription is cancelled at the end of its paid period, not immediately");
    }
    const ownerId = sub.ownerId.toString();
    return sub.ownerType === "agency" ? cancelAgencySubscription(ownerId) : cancelSubscription(ownerId);
  }

  const target: SubscriptionStatus = input.when === "immediately" ? "cancelled" : "cancelling";
  if (sub.status === target || !isValidSubscriptionTransition(sub.status as SubscriptionStatus, target)) {
    throw ApiError.conflict(target === "cancelling" ? "This subscription is already set to cancel" : `A ${sub.status} subscription can't be cancelled`);
  }
  const updated = await guardedUpdate(sub, {
    $set: {
      status: target,
      ...(target === "cancelling" ? { cancelAt: sub.currentPeriodEnd } : { cancelledAt: now }),
      ...(input.note ? { "manualBilling.note": input.note } : {}),
    },
  });
  await recordBillingHistoryEvent({
    ownerType: updated.ownerType as SubscriptionOwnerType,
    ownerId: updated.ownerId.toString(),
    subscriptionId: updated._id,
    type: target === "cancelling" ? "cancellation_requested" : "cancelled",
    provider: "manual",
    metadata: { source: "platform_admin" },
  });
  return updated;
}
