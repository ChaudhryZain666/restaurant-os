import { Badge } from "@restaurant/ui";

const SCOPE_LABEL = {
  location: "This location only",
  business: "All locations",
  agency: "This agency",
} as const;

/**
 * Portal UX safety phase — one small, reusable badge for "what does this page/action affect,"
 * reused across pages that were previously silent about their business/location/agency scope
 * (Analytics, Business Analytics, Theme Studio, Audit log, Support, Delivery, Staff, Promotions,
 * Business Promotions, Loyalty). Settings and Menu already carry their own inline-styled scope
 * indicator from an earlier phase — left as-is rather than churned to use this component, since
 * they already communicate the same thing correctly.
 */
export function ScopeBadge({ scope }: { scope: keyof typeof SCOPE_LABEL }) {
  return <Badge tone="info">{SCOPE_LABEL[scope]}</Badge>;
}
