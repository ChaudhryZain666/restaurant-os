import type { HydratedDocument } from "mongoose";
import type { SubscriptionOwnerType, SubscriptionStatus } from "@restaurant/types";
import { Subscription, type SubscriptionDoc } from "../models/Subscription.js";
import { Plan, type PlanDoc } from "../models/Plan.js";

/**
 * Phase 63 — the single, shared source of truth for "is this subscription genuinely live," used by
 * entitlementLimit.service.ts, agencyEntitlement.service.ts, and subscription.service.ts alike.
 * Previously each of those three files declared its own identical copy of this array — harmless
 * while they all agreed, but exactly the kind of duplication that lets one call site silently drift
 * from the others. Centralized here instead; nothing about the actual state values changed.
 */
export const LIVE_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "cancelling"];

/**
 * Phase 63 critical fix — a `"trialing"` subscription whose `trialEnd` has already passed is NOT
 * live, even though its `status` field may still literally read `"trialing"`. Before this phase,
 * nothing in this codebase ever transitioned a trial's status to `"expired"` except a real billing
 * provider's webhook reporting the trial ended unconverted — a trigger that has never once fired,
 * since no environment (dev, test, or production so far) has ever had a live, connected provider.
 * That meant every trial silently stayed "trialing" — a LIVE status — forever, granting full paid
 * entitlements indefinitely regardless of how much real time had passed.
 *
 * `runTrialExpirationSweep` (subscription.service.ts) is the complementary background job that
 * eventually persists `status: "expired"` for bookkeeping/display — but entitlement and capacity
 * DECISIONS must be correct the instant the boundary passes, not dependent on that job's cadence.
 * This function (and `resolveSubscriptionState` below, which is built on it) is that real-time
 * check — called from the read/decision path, never assumed to already be reflected in `status`.
 */
export function isSubscriptionLive(
  sub: Pick<SubscriptionDoc, "status" | "trialEnd">,
  now: Date = new Date()
): boolean {
  if (!LIVE_STATUSES.includes(sub.status as SubscriptionStatus)) return false;
  if (sub.status === "trialing" && sub.trialEnd && sub.trialEnd.getTime() <= now.getTime()) return false;
  return true;
}

export type SubscriptionResolution =
  | { kind: "live"; plan: HydratedDocument<PlanDoc>; subscription: HydratedDocument<SubscriptionDoc> }
  /** Has a real (non-"internal") subscription in its history, but it is not live right now — a
   *  converted-nothing trial, or a cancelled/expired paid subscription. Distinct from "never" on
   *  purpose: this owner has, at some point, made a real commercial choice, so the platform's
   *  generous grandfathering default (reserved for accounts that predate the commercial catalog
   *  entirely) must not apply to them. */
  | { kind: "lapsed" }
  /** No real subscription has ever existed for this owner — the only case the generous
   *  no-subscription default is meant to cover. */
  | { kind: "never" };

/**
 * The one place "is this owner live, lapsed, or has never subscribed" is decided. Shared by
 * entitlementLimit.service.ts's resolveBusinessPlanWithInheritance and
 * agencyEntitlement.service.ts's getMaxBusinesses, so the exact same distinction applies to every
 * entitlement and capacity decision — never duplicated, never allowed to drift.
 *
 * `provider: "internal"` subscriptions (comped/grandfathered, Phase 24's backfill script) are
 * excluded from consideration entirely, same as every other live-subscription check in this
 * codebase — an owner whose only-ever subscription was "internal" resolves as "never", not
 * "lapsed", preserving the existing grandfathering guarantee unchanged.
 */
export async function resolveSubscriptionState(
  ownerType: SubscriptionOwnerType,
  ownerId: string,
  now: Date = new Date()
): Promise<SubscriptionResolution> {
  const mostRecent = await Subscription.findOne({ ownerType, ownerId, provider: { $ne: "internal" } }).sort({ createdAt: -1 });
  if (!mostRecent) return { kind: "never" };
  if (isSubscriptionLive(mostRecent, now)) {
    const plan = await Plan.findById(mostRecent.planId);
    if (!plan) return { kind: "never" }; // defensive — a dangling FK behaves like no subscription, never crashes
    return { kind: "live", plan, subscription: mostRecent };
  }
  return { kind: "lapsed" };
}
