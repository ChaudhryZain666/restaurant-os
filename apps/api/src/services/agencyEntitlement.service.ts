import { Agency } from "../models/Agency.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";
import { getEntitlements } from "./entitlement.service.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 25 — a real, checkable "can this agency create another business?" mechanism, not a number
 * hardcoded in a controller. Distinct from `entitlement` (what a plan includes, entitlement.service.ts)
 * and from `billing status` (subscription.service.ts) per the brief's explicit "do not mix these
 * concepts": this module answers ONE question — usage against a limit — by combining both.
 *
 * No commercial `max_businesses` value has been decided. When an agency has no subscription at
 * all, or its plan has no `max_businesses` entitlement, this generous, explicitly-non-final default
 * applies — the same honesty convention Phase 24 established for TRIAL_PERIOD_DAYS=14: "a working
 * default that lets the feature be fully exercised and tested, not a commercial decision." This
 * deliberately does NOT hard-block agency business creation just because billing isn't set up yet,
 * consistent with Phase 24's "don't prematurely gate" philosophy.
 */
const NO_SUBSCRIPTION_DEFAULT_MAX_BUSINESSES = 3;

async function getMaxBusinesses(agencyId: string): Promise<number> {
  // Phase 27 — provider:"internal" (grandfathered/comped, no real commercial relationship) is
  // deliberately excluded here too, treated identically to "no subscription at all" — the same
  // fix entitlementLimit.service.ts's resolveOwnerPlan needed, for the identical reason: a
  // grandfathered subscription must never introduce a NEW restriction a real one would.
  const subscription = await Subscription.findOne({
    ownerType: "agency",
    ownerId: agencyId,
    status: { $in: ["trialing", "active", "past_due", "cancelling"] },
    provider: { $ne: "internal" },
  });
  if (!subscription) return NO_SUBSCRIPTION_DEFAULT_MAX_BUSINESSES;

  const plan = await Plan.findById(subscription.planId);
  if (!plan) return NO_SUBSCRIPTION_DEFAULT_MAX_BUSINESSES;

  const value = getEntitlements(plan).max_businesses;
  return typeof value === "number" && value > 0 ? value : NO_SUBSCRIPTION_DEFAULT_MAX_BUSINESSES;
}

/** Read-only check — e.g. for the frontend to disable a "Create business" action ahead of time.
 *  Not itself race-safe under concurrency; reserveBusinessSlot below is the real, atomic guard. */
export async function canCreateAnotherBusiness(agencyId: string): Promise<boolean> {
  const [agency, maxBusinesses] = await Promise.all([Agency.findById(agencyId).select("businessCount"), getMaxBusinesses(agencyId)]);
  if (!agency) return false;
  return agency.businessCount < maxBusinesses;
}

/**
 * Atomically reserves one business slot — the real concurrency guard for "two agency users
 * creating businesses at the same moment can't together exceed the limit." A single
 * findOneAndUpdate with the limit as part of the filter, not a check-then-insert: the same
 * atomic-guard-not-check-then-insert principle Phase 23/24 already established (Promotion usage
 * limits, Subscription creation). Throws ApiError.conflict (409) if the agency is already at its
 * limit — the caller (createAgencyBusiness) must call this BEFORE starting its own transaction,
 * since a failed reservation should abort the whole operation, not partially commit.
 */
export async function reserveBusinessSlot(agencyId: string): Promise<void> {
  const maxBusinesses = await getMaxBusinesses(agencyId);
  const updated = await Agency.findOneAndUpdate({ _id: agencyId, businessCount: { $lt: maxBusinesses } }, { $inc: { businessCount: 1 } });
  if (!updated) throw ApiError.conflict(`This agency has reached its business limit (${maxBusinesses})`);
}

export async function getAgencyEntitlements(agencyId: string): Promise<{ maxBusinesses: number; businessCount: number }> {
  const [agency, maxBusinesses] = await Promise.all([Agency.findById(agencyId).select("businessCount"), getMaxBusinesses(agencyId)]);
  return { maxBusinesses, businessCount: agency?.businessCount ?? 0 };
}
