import type { NextFunction, Request, Response } from "express";
import type { SubscriptionOwnerType } from "@restaurant/types";
import { Business } from "../models/Business.js";
import type { PlanDoc } from "../models/Plan.js";
import { Restaurant } from "../models/Restaurant.js";
import { getEntitlements, hasEntitlement, type EntitlementValue } from "./entitlement.service.js";
import { resolveSubscriptionState } from "./subscriptionResolution.service.js";
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

export type BusinessPlanResolution =
  | { plan: PlanDoc; source: "business" | "agency" }
  /** This business (or its managing agency) has a real subscription history, but nothing live right
   *  now — Phase 63's critical fix. Must NEVER be treated the same as "never subscribed": that
   *  would let an expired trial or a cancelled paid subscription silently keep receiving the
   *  generous grandfathering default forever. */
  | { source: "lapsed" }
  /** No real subscription has ever existed anywhere in the chain — the only case the generous
   *  no-subscription default (below) is meant to cover. */
  | null;

/**
 * Phase 39 (inheritance precedence) + Phase 63 (lapsed-vs-never distinction) — the precedence:
 * (1) the business's own subscription history, if any exists — a LIVE one wins outright; a LAPSED
 *     one (had one, not live now) resolves to `{source:"lapsed"}` immediately, never falling through
 *     to check the agency — a business that had its own direct commercial relationship end is not
 *     entitled to quietly inherit its agency's plan instead.
 * (2) only when the business has NEVER had its own subscription: an agency-inherited entitlement
 *     source, if the business is agency-managed AND that agency's subscription history resolves
 *     live — a LAPSED agency subscription resolves the managed business to `{source:"lapsed"}` too
 *     (Phase 63 — an agency whose own subscription ended must not keep silently granting its managed
 *     businesses premium access).
 * (3) failing both — neither the business nor (if applicable) its agency has EVER had a real
 *     subscription — `null`, and callers fall back to the existing generous no-subscription default,
 *     UNCHANGED, so grandfathered/pre-existing accounts are never retroactively capped.
 *
 * See docs/commercial-decisions.md §14/§19 for the original inheritance decision and reversal this
 * builds on, and docs/entitlement-architecture.md for the full, current picture.
 */
async function resolveBusinessPlanWithInheritance(businessId: string): Promise<BusinessPlanResolution> {
  const ownState = await resolveSubscriptionState("business", businessId);
  if (ownState.kind === "live") return { plan: ownState.plan, source: "business" };
  if (ownState.kind === "lapsed") return { source: "lapsed" };

  const business = await Business.findById(businessId).select("agencyId");
  if (!business?.agencyId) return null;

  const agencyState = await resolveSubscriptionState("agency", business.agencyId.toString());
  if (agencyState.kind === "live") return { plan: agencyState.plan, source: "agency" };
  if (agencyState.kind === "lapsed") return { source: "lapsed" };
  return null;
}

/**
 * Boolean feature-entitlement check. Genuinely NO subscription history anywhere in the chain
 * defaults to TRUE — deliberately generous, so an account that predates the commercial catalog is
 * never retroactively broken (see docs/commercial-decisions.md §6/§19). A LAPSED subscription
 * (Phase 63) defaults to FALSE instead — an expired trial or a cancelled/expired paid subscription
 * must never keep receiving paid-only features merely because resolution "found nothing live." Only
 * a genuinely live, real plan grants a feature on its own explicit terms.
 */
export async function hasFeatureEntitlement(ownerType: SubscriptionOwnerType, ownerId: string, key: string): Promise<boolean> {
  if (ownerType === "business") {
    const resolved = await resolveBusinessPlanWithInheritance(ownerId);
    if (!resolved) return true;
    if (resolved.source === "lapsed") return false;
    return hasEntitlement(resolved.plan, key);
  }
  const state = await resolveSubscriptionState(ownerType, ownerId);
  if (state.kind === "never") return true;
  if (state.kind === "lapsed") return false;
  return hasEntitlement(state.plan, key);
}

/**
 * Resolves a business's effective entitlements for API responses (subscription.controller.ts's
 * GET .../subscription/entitlements) — never 404s for "no direct subscription," since an
 * agency-managed business can have real, meaningful entitlements without one. `source` tells the
 * caller which relationship the entitlements came from, purely informational (never itself an
 * authorization decision) — `"lapsed"` (Phase 63) lets the UI honestly distinguish "you've never
 * subscribed" from "your subscription ended," rather than presenting both identically as "default".
 */
export async function resolveBusinessEntitlements(
  businessId: string
): Promise<{ entitlements: Record<string, EntitlementValue> | null; source: "business" | "agency" | "lapsed" | "default" }> {
  const resolved = await resolveBusinessPlanWithInheritance(businessId);
  if (!resolved) return { entitlements: null, source: "default" };
  if (resolved.source === "lapsed") return { entitlements: null, source: "lapsed" };
  return { entitlements: getEntitlements(resolved.plan), source: resolved.source };
}

/**
 * Phase 76 — the agency-level counterpart to resolveBusinessEntitlements, closing a real gap this
 * launch audit found: agencySubscription.controller.ts's getAgencyEntitlementsHandler used to read
 * getSubscriptionForAgency directly (the most recent subscription regardless of status) and hand
 * back that plan's entitlements unconditionally — so an EXPIRED, CANCELLED, or silently-past-
 * trialEnd agency subscription still reported full plan entitlements, never routing through
 * isSubscriptionLive/resolveSubscriptionState the way every other entitlement decision in this
 * codebase does. Same "lapsed vs. never" honesty this businesses's own resolver already has (Phase
 * 63) — an agency has no further inheritance level above it, so there's no third branch to add.
 */
export async function resolveAgencyEntitlements(
  agencyId: string
): Promise<{ entitlements: Record<string, EntitlementValue> | null; source: "agency" | "lapsed" | "default" }> {
  const state = await resolveSubscriptionState("agency", agencyId);
  if (state.kind === "never") return { entitlements: null, source: "default" };
  if (state.kind === "lapsed") return { entitlements: null, source: "lapsed" };
  return { entitlements: getEntitlements(state.plan), source: "agency" };
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
  if (resolved.source === "lapsed") {
    // Phase 63 — frozen at whatever the business already has: never destructive (existing locations
    // are never touched or disabled), but never allows further growth without a live subscription
    // either. The technically-minimal, non-commercial floor — not a plan's specific number.
    const business = await Business.findById(businessId).select("locationCount");
    return business?.locationCount ?? 0;
  }
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
