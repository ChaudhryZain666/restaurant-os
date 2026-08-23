/**
 * Phase 24 — the commercial catalog. `type` is the commercial tier (what this plan includes),
 * deliberately separate from a Subscription's `ownerType` (who structurally holds it) — see
 * docs/multi-tenant-storefront-architecture.md's Phase 24 section for why those are kept
 * independent rather than collapsed into one field.
 */
export type PlanType = "OWNER" | "AGENCY";

export type BillingInterval = "monthly" | "yearly";

/**
 * `amountCents`/`currency` are deliberately optional — no real commercial pricing has been decided
 * yet (a pending business decision, not an oversight), so a Plan can exist and be exercised in
 * every other way (entitlements, subscribing via the mock provider, lifecycle transitions) without
 * inventing a number here. Real prices land as pure data on this array once decided, never as a
 * hardcoded literal anywhere in application code.
 */
export interface PlanPricing {
  interval: BillingInterval;
  amountCents?: number;
  currency?: string;
}

export interface PlanEntitlement {
  key: string;
  value: boolean | number | string;
}

export interface Plan {
  id: string;
  code: string;
  name: string;
  type: PlanType;
  pricing: PlanPricing[];
  entitlements: PlanEntitlement[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
