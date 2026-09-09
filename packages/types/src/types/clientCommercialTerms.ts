/**
 * Phase 59 — what an agency charges its OWN client for its services. Deliberately NOT a Subscription
 * and NOT collected/processed by the platform: no provider, no webhook, no invoice. See
 * apps/api/src/models/ClientCommercialTerms.ts's doc comment for the full honesty boundary this
 * enforces, and entitlementLimit.service.ts for the (unrelated, unmodified) chain that actually
 * determines a business's real feature entitlements.
 */
export const CLIENT_COMMERCIAL_STATUSES = ["trial", "active", "cancelled"] as const;
export type ClientCommercialStatus = (typeof CLIENT_COMMERCIAL_STATUSES)[number];

export interface ClientCommercialTerms {
  id: string;
  agencyId: string;
  businessId: string;
  planLabel?: string;
  priceAmountCents?: number;
  currency: string;
  billingCycle?: "monthly" | "yearly";
  status: ClientCommercialStatus;
  trialEndsAt?: string;
  startedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
