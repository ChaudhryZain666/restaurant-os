import { Link } from "react-router-dom";
import { Badge, Button, Card, Reveal } from "@restaurant/ui";
import { usePublicPlans, formatPlanPrice } from "../lib/plans";

/** Phase 28 — compact homepage pricing teaser, same real Plan-catalog data PricingPage.tsx shows in
 *  full (GET /public/plans) — never a second hardcoded number. */
export function PricingTeaser() {
  const { plans } = usePublicPlans();
  const ownerPlan = plans?.find((p) => p.type === "OWNER");
  const agencyPlan = plans?.find((p) => p.type === "AGENCY");

  if (!ownerPlan && !agencyPlan) return null;

  return (
    <div className="mx-auto grid max-w-3xl gap-4 sm:grid-cols-2">
      {[ownerPlan, agencyPlan]
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((plan, i) => (
          <Reveal key={plan.code} index={i}>
            {/* Fixed light "paper" tones — see FeatureCard.tsx's identical note: bg-surface itself
                turns dark under the Home page's .theme-obsidian palette, which would silently lose the
                "light card on dark canvas" pattern. A no-op on every other (already-light) page. */}
            <Card className="flex flex-col gap-2 border-[color:var(--gt-border-fixed)] bg-[color:var(--gt-surface-fixed)]">
              <p className="font-heading text-sm font-medium text-[color:var(--gt-text-fixed)]">{plan.name}</p>
              <p className="font-heading text-2xl font-semibold text-[color:var(--gt-text-fixed)]">
                {formatPlanPrice(plan.pricing, "monthly") ?? "Contact us"}
                {formatPlanPrice(plan.pricing, "monthly") && <span className="text-sm font-normal text-[color:var(--gt-text-muted-fixed)]">/mo</span>}
              </p>
              {plan.trialDays && <Badge tone="warning">{plan.trialDays}-day free trial</Badge>}
            </Card>
          </Reveal>
        ))}
      <div className="sm:col-span-2 flex justify-center">
        <Link to="/pricing">
          <Button variant="outline">See full pricing</Button>
        </Link>
      </div>
    </div>
  );
}
