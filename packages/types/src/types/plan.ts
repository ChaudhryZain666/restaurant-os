/**
 * Phase 24 — the commercial catalog. `type` is the commercial tier (what this plan includes),
 * deliberately separate from a Subscription's `ownerType` (who structurally holds it) — see
 * docs/multi-tenant-storefront-architecture.md's Phase 24 section for why those are kept
 * independent rather than collapsed into one field.
 */
export type PlanType = "OWNER" | "AGENCY";

export type BillingInterval = "monthly" | "yearly";

/**
 * `amountCents`/`currency` are deliberately optional — the seeded catalog (Phase 27) now populates
 * them with PROPOSED pricing (see docs/commercial-decisions.md — explicitly not a final commercial
 * decision), but the type/schema still supports a Plan existing and being exercised in every other
 * way (entitlements, subscribing via the mock provider, lifecycle transitions) without a price. Real
 * prices land as pure data on this array, never as a hardcoded literal anywhere in application code.
 */
export interface PlanPricing {
  interval: BillingInterval;
  amountCents?: number;
  currency?: string;
  /** The billing provider's own identifier for this specific interval's price (e.g. a Paddle
   *  "Price" id) — how checkout tells the provider WHICH price to sell. Never the source of truth
   *  for the actual charge amount; the provider's own webhook payload is what's trusted for that. */
  providerPriceId?: string;
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
  description?: string;
  pricing: PlanPricing[];
  entitlements: PlanEntitlement[];
  /** The billing provider's own product identifier — one per Plan, distinct from each interval's
   *  own providerPriceId above. Absent for the mock provider. */
  providerProductId?: string;
  /** Per-plan trial-length override, in days. Absent falls back to env.TRIAL_PERIOD_DAYS — see
   *  subscription.service.ts's resolveTrialDays. */
  trialDays?: number;
  /** Free-form catalog metadata (e.g. a marketing "most popular" flag). Never read for
   *  authorization/entitlement decisions — entitlements[] is the only mechanism for that. */
  metadata?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
