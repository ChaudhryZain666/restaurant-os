import type { SubscriptionOwnerType } from "@restaurant/types";
import { Business } from "../models/Business.js";
import { Agency } from "../models/Agency.js";
import { User } from "../models/User.js";

/**
 * Phase 25 — resolves the {name, email} a billing provider customer record (or a lifecycle
 * notification) needs, for either owner type. Extracted from subscription.service.ts (Phase 34) so
 * billingHistory.service.ts can resolve the same identity for lifecycle emails (trial-ending,
 * past_due, cancelled) without importing from subscription.service.ts, which itself imports
 * recordBillingHistoryEvent from billingHistory.service.ts — a shared leaf module avoids that
 * circular dependency.
 */
export async function resolveOwnerIdentity(
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
