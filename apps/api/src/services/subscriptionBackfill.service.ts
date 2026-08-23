import { Business } from "../models/Business.js";
import { Plan } from "../models/Plan.js";
import { Subscription } from "../models/Subscription.js";

// A business's grandfathered period-end is set far enough out that it never expires on its own —
// this is NOT a real billing period (no charge is ever attempted against it), just an explicit,
// documented placeholder so `currentPeriodEnd` is never left ambiguous. See Subscription.provider's
// "internal" doc comment for the full reasoning.
const GRANDFATHERED_PERIOD_YEARS = 100;

export interface BackfillSummaryEntry {
  businessId: string;
  businessName: string;
  action: "created" | "skipped-existing-subscription" | "skipped-no-owner-plan";
}

/**
 * Phase 24 migration — every Business created before this phase has NO Subscription document at
 * all (absence, not a wrong status; no existing route checks subscription state, so this was
 * always safe). Creates one `active`, `provider: "internal"` (grandfathered, no real billing
 * relationship) Subscription per Business that doesn't already have ANY Subscription document —
 * live or historical — so re-running this script is a no-op the second time, and a business that's
 * already real-subscribed (even if since cancelled) is never touched.
 */
export async function backfillSubscriptions(options: {
  dryRun: boolean;
  /** Scopes the scan to specific businesses — the real CLI run omits this (every Business), while
   *  tests pass their own fixture ids so this shared-DB migration never touches another test
   *  file's concurrently-running fixtures (the same shared-DB-safety convention every other test
   *  in this codebase follows by scoping queries to its own created ids). */
  businessIds?: string[];
}): Promise<BackfillSummaryEntry[]> {
  const ownerPlan = await Plan.findOne({ code: "owner" });
  const businesses = await Business.find(options.businessIds ? { _id: { $in: options.businessIds } } : {});
  const summary: BackfillSummaryEntry[] = [];

  for (const business of businesses) {
    const existing = await Subscription.findOne({ ownerType: "business", ownerId: business._id });
    if (existing) {
      summary.push({ businessId: business.id as string, businessName: business.name, action: "skipped-existing-subscription" });
      continue;
    }
    if (!ownerPlan) {
      summary.push({ businessId: business.id as string, businessName: business.name, action: "skipped-no-owner-plan" });
      continue;
    }

    if (!options.dryRun) {
      const now = new Date();
      const currentPeriodEnd = new Date(now);
      currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + GRANDFATHERED_PERIOD_YEARS);

      await Subscription.create({
        ownerType: "business",
        ownerId: business._id,
        planId: ownerPlan._id,
        status: "active",
        billingInterval: "monthly",
        currentPeriodStart: now,
        currentPeriodEnd,
        provider: "internal",
      });
    }
    summary.push({ businessId: business.id as string, businessName: business.name, action: "created" });
  }

  return summary;
}
