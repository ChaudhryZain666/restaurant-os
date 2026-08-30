import type { NextFunction, Request, Response } from "express";
import type { SubscriptionOwnerType } from "@restaurant/types";
import { Business } from "../models/Business.js";
import { Plan, type PlanDoc } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { Subscription } from "../models/Subscription.js";
import { getEntitlements, hasEntitlement, type EntitlementValue } from "./entitlement.service.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * Phase 27 — the central entitlement/limit enforcement point the brief explicitly asks for
 * ("do NOT scatter plan checks throughout controllers"). Two enforcement shapes, deliberately not
 * one: boolean feature entitlements (custom_domains, business_analytics, business_promotions) are a
 * pure read used by requireEntitlement middleware; COUNT-based limits (locations, and — re-exported
 * below — agency businesses) stay atomic reservations a controller calls explicitly, because they
 * need pre-transaction reservation + rollback-on-failure semantics a boolean middleware can't
 * naturally express. See docs/multi-tenant-storefront-architecture.md's Phase 27 section for the
 * full reasoning behind this split.
 *
 * canCreateAnotherBusiness/reserveBusinessSlot/getAgencyEntitlements (agencyEntitlement.service.ts,
 * Phase 25) are re-exported here so this module is the one place to look for every entitlement/limit
 * function, without duplicating their logic.
 */
export { canCreateAnotherBusiness, reserveBusinessSlot, getAgencyEntitlements } from "./agencyEntitlement.service.js";

const LIVE_STATUSES = ["trialing", "active", "past_due", "cancelling"] as const;

/**
 * No commercial "included locations" limit has been finalized. When a business has no subscription
 * at all — true of every business that existed before this phase, and of any brand-new business
 * that simply hasn't subscribed yet — this generous, explicitly non-final default applies, the same
 * honesty convention agencyEntitlement.service.ts established for NO_SUBSCRIPTION_DEFAULT_MAX_BUSINESSES:
 * a working default that lets the feature be fully exercised and tested, never a commercial decision,
 * and NEVER a hard 0/deny-by-default that would break an existing multi-location business.
 *
 * 20, not a smaller number: real regression testing against this project's own long-lived seeded
 * dev data found a real business (the "Spice Route" demo account, repeatedly exercised by
 * shared-menu-canonical-override.spec.ts over this project's history) with 9 real accumulated
 * locations — proof that a lower default would have broken real existing data, not just a
 * hypothetical. Chosen with real headroom above that observed number, not arbitrarily.
 */
const NO_SUBSCRIPTION_DEFAULT_MAX_LOCATIONS = 20;

/**
 * Resolves the live, REAL (non-"internal") subscription's Plan for an owner, or null if there is
 * none — the one shared lookup every entitlement/limit check in this module goes through.
 *
 * `provider: "internal"` subscriptions are deliberately EXCLUDED here, treated identically to "no
 * subscription at all." The same real regression testing that set NO_SUBSCRIPTION_DEFAULT_MAX_LOCATIONS
 * above also found this: Phase 24's backfillSubscriptions.ts grandfathers every pre-existing
 * business onto a real, live `provider:"internal"` Subscription pointed at the shared "owner" Plan
 * — so the moment that Plan's own entitlements gained a real `max_locations` value, EVERY
 * grandfathered business (including ones with far more locations already than that number) would
 * have been retroactively capped. "internal" exists specifically to mean "comped, no real
 * commercial relationship" — it must never introduce a NEW restriction a real subscription would.
 */
async function resolveOwnerPlan(ownerType: SubscriptionOwnerType, ownerId: string): Promise<PlanDoc | null> {
  const subscription = await Subscription.findOne({ ownerType, ownerId, status: { $in: LIVE_STATUSES }, provider: { $ne: "internal" } });
  if (!subscription) return null;
  return Plan.findById(subscription.planId);
}

/**
 * Phase 39 — the precedence model the founder decision requires: (1) the business's own direct
 * subscription, if it has one; (2) failing that, an agency-inherited entitlement source, if the
 * business is agency-managed AND that agency has a live, real subscription (LIVE_STATUSES already
 * includes "cancelling" and "past_due", so this reuses the existing state machine as the grace
 * period rather than inventing a second one — a cancelling agency subscription keeps granting
 * inherited entitlements through its paid period, exactly like a business's own subscription would);
 * (3) failing both, `null` — callers fall back to the existing generous no-subscription defaults
 * below, UNCHANGED, so grandfathered/pre-existing businesses are never retroactively capped.
 *
 * This closes the gap the Phase 39 audit found: previously an agency-managed business with no
 * subscription of its own always hit the generous defaults for free, regardless of whether its
 * managing agency was itself a paying customer. It does NOT change behavior for a business that
 * isn't agency-managed, or whose agency has no live subscription — both still fall through to the
 * same defaults as before. Supersedes docs/commercial-decisions.md §14's original "an agency-created
 * business does not inherit its managing agency's subscription" decision — see that doc's Phase 39
 * section for the reversal and reasoning.
 */
async function resolveBusinessPlanWithInheritance(businessId: string): Promise<{ plan: PlanDoc; source: "business" | "agency" } | null> {
  const directPlan = await resolveOwnerPlan("business", businessId);
  if (directPlan) return { plan: directPlan, source: "business" };

  const business = await Business.findById(businessId).select("agencyId");
  if (!business?.agencyId) return null;

  const agencyPlan = await resolveOwnerPlan("agency", business.agencyId.toString());
  if (!agencyPlan) return null;

  return { plan: agencyPlan, source: "agency" };
}

/**
 * Boolean feature-entitlement check. No subscription (or a subscription whose plan lacks the key)
 * defaults to TRUE — deliberately generous, so this phase's enforcement can never retroactively
 * break an existing business or agency that never subscribed at all. It becomes a REAL, meaningful
 * gate only once an owner/agency has an active subscription on a plan that explicitly excludes the
 * feature — see docs/commercial-decisions.md. For a `"business"` owner, this now resolves through
 * the agency-inheritance precedence above before falling back to the generous default.
 */
export async function hasFeatureEntitlement(ownerType: SubscriptionOwnerType, ownerId: string, key: string): Promise<boolean> {
  if (ownerType === "business") {
    const resolved = await resolveBusinessPlanWithInheritance(ownerId);
    if (!resolved) return true;
    return hasEntitlement(resolved.plan, key);
  }
  const plan = await resolveOwnerPlan(ownerType, ownerId);
  if (!plan) return true;
  return hasEntitlement(plan, key);
}

/**
 * Resolves a business's effective entitlements for API responses (subscription.controller.ts's
 * GET .../subscription/entitlements) — never 404s for "no direct subscription," since an
 * agency-managed business can have real, meaningful entitlements without one. `source` tells the
 * caller which relationship the entitlements came from, purely informational (never itself an
 * authorization decision).
 */
export async function resolveBusinessEntitlements(
  businessId: string
): Promise<{ entitlements: Record<string, EntitlementValue> | null; source: "business" | "agency" | "default" }> {
  const resolved = await resolveBusinessPlanWithInheritance(businessId);
  if (!resolved) return { entitlements: null, source: "default" };
  return { entitlements: getEntitlements(resolved.plan), source: resolved.source };
}

/**
 * Express middleware — chained AFTER requireBusinessMatch/requireBusinessPermission (or
 * requireTenantMatch/requireTenantPermission for a location-scoped route) on the routers that
 * actually gate a feature this way (businessAnalytics/businessPromotion at the business level;
 * restaurantDomain's location-level domain-creation route, since custom-domain MANAGEMENT is a
 * per-location action even though the entitlement itself is business-wide). Always resolves against
 * `hasFeatureEntitlement("business", businessId, key)` — which, as of Phase 39, checks the
 * business's OWN subscription first, then falls back to its managing agency's live subscription if
 * it's agency-managed and has none of its own (resolveBusinessPlanWithInheritance's precedence).
 * See docs/commercial-decisions.md §19 for the full decision — this reverses the original Phase 27
 * behavior, where an agency-managed business was never gated by its agency's subscription at all.
 *
 * `from: "restaurantId"` resolves the business via that location's own businessId first (one extra
 * read, only on that code path) — used only by the one location-scoped route this phase gates.
 */
export function requireEntitlement(key: string, from: "businessId" | "restaurantId" = "businessId") {
  return async (req: Request, _res: Response, next: NextFunction) => {
    let businessId: string | undefined;
    if (from === "businessId") {
      businessId = req.params.businessId;
    } else {
      const restaurant = await Restaurant.findById(req.params.restaurantId).select("businessId");
      businessId = restaurant?.businessId?.toString();
    }
    if (!businessId) return next(ApiError.badRequest("Could not resolve which business this route belongs to"));
    const allowed = await hasFeatureEntitlement("business", businessId, key);
    if (!allowed) return next(ApiError.forbidden(`This business's plan does not include "${key}"`));
    next();
  };
}

/**
 * Phase 39 — an agency-inherited plan is an AGENCY-type Plan, which expresses its managed-business
 * location allowance under a DIFFERENT key (`managed_business_max_locations`) than a direct
 * OWNER-type subscription's `max_locations`, so the two are never confused with the agency's own
 * `max_businesses` limit. A legacy agency plan (seeded before Phase 39, e.g. `agency_starter`/
 * `agency_growth`) has no `managed_business_max_locations` key at all — falls through to the same
 * generous default a direct no-subscription business gets, which is the correct, non-retroactive
 * direction to err (see resolveBusinessPlanWithInheritance's doc comment).
 */
async function getMaxLocations(businessId: string): Promise<number> {
  const resolved = await resolveBusinessPlanWithInheritance(businessId);
  if (!resolved) return NO_SUBSCRIPTION_DEFAULT_MAX_LOCATIONS;
  const key = resolved.source === "agency" ? "managed_business_max_locations" : "max_locations";
  const value = getEntitlements(resolved.plan)[key];
  return typeof value === "number" && value > 0 ? value : NO_SUBSCRIPTION_DEFAULT_MAX_LOCATIONS;
}

/** Read-only check — e.g. for the frontend to disable an "Add location" action ahead of time. Not
 *  itself race-safe under concurrency; reserveLocationSlot below is the real, atomic guard. */
export async function canCreateLocation(businessId: string): Promise<boolean> {
  const [business, maxLocations] = await Promise.all([Business.findById(businessId).select("locationCount"), getMaxLocations(businessId)]);
  if (!business) return false;
  return business.locationCount < maxLocations;
}

/**
 * Atomically reserves one location slot — mirrors reserveBusinessSlot exactly (a single
 * findOneAndUpdate with the limit as part of the filter, not a check-then-insert). Throws
 * ApiError.conflict (409) if the business is already at its limit. Callers (createLocationForBusiness,
 * createRestaurant's existing-business branch) must call this BEFORE starting their own transaction,
 * and must release the reservation ($inc:-1) if that transaction subsequently fails.
 */
export async function reserveLocationSlot(businessId: string): Promise<void> {
  const maxLocations = await getMaxLocations(businessId);
  const updated = await Business.findOneAndUpdate({ _id: businessId, locationCount: { $lt: maxLocations } }, { $inc: { locationCount: 1 } });
  if (!updated) throw ApiError.conflict(`This business has reached its location limit (${maxLocations})`);
}

export async function releaseLocationSlot(businessId: string): Promise<void> {
  await Business.findByIdAndUpdate(businessId, { $inc: { locationCount: -1 } });
}

/** For the frontend's "add location" affordance — a pre-check, never itself an authorization
 *  decision (reserveLocationSlot's atomic guard remains the real one). Works whether or not the
 *  business has a subscription at all, same as getEntitlementsHandler (Phase 39 — no longer 404s
 *  when there's no direct subscription, since an agency-managed business can still have real,
 *  inherited entitlements). */
export async function getLocationLimitStatus(businessId: string): Promise<{ max: number; current: number; canCreate: boolean }> {
  const [business, max] = await Promise.all([Business.findById(businessId).select("locationCount"), getMaxLocations(businessId)]);
  const current = business?.locationCount ?? 0;
  return { max, current, canCreate: current < max };
}
