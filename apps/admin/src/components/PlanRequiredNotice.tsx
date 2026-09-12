import { Link } from "react-router-dom";
import { Badge, Button, Card } from "@restaurant/ui";

interface PlanRequiredNoticeProps {
  /** Plain-language feature name, e.g. "Business-wide analytics", "Custom domains". */
  featureLabel: string;
  /** Defaults to the owner's own billing page — pass "/agency/billing" from an agency-scoped surface. */
  billingPath?: string;
}

/**
 * Phase 64 — the one shared lock-state notice for every plan-gated feature (Business Analytics,
 * Business Promotions, Custom Domains today), replacing three near-identical, independently
 * hand-written blocks that each hardcoded "Upgrade to Owner — Growth" as the suggested plan. That
 * wording was wrong for a LAPSED account (which may have been on any plan, or none) and would also
 * go stale the moment pricing/packaging changes — this deliberately never names a specific plan,
 * matching the Phase 64 brief's own instruction: prefer "Choose a plan" over guessing a target tier.
 *
 * Server-side `requireEntitlement` remains the sole real authorization boundary (businessAnalytics/
 * businessPromotion/restaurantDomain routes) — this is convenience only, driven by
 * useBusinessEntitlements, which already can't disagree with the server (Phase 63's `source: "lapsed"`
 * fix).
 */
export function PlanRequiredNotice({ featureLabel, billingPath = "/billing" }: PlanRequiredNoticeProps) {
  return (
    <Card className="flex flex-col items-start gap-2">
      <Badge tone="warning">Requires an active plan</Badge>
      <p className="text-sm text-foreground">{featureLabel} requires an active plan on this account.</p>
      <Link to={billingPath}>
        <Button size="sm">Choose a plan</Button>
      </Link>
    </Card>
  );
}
