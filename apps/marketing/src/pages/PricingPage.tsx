import { Link } from "react-router-dom";
import { Alert, Badge, Button, Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconCheck } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";
import { FAQS } from "../lib/content";
import { usePublicPlans, formatPlanPrice, type PublicPlan } from "../lib/plans";

const ENTITLEMENT_LABELS: Record<string, string> = {
  custom_domains: "Custom domain / white-label",
  business_analytics: "Business analytics",
  business_promotions: "Promotions & discount codes",
};

function planFeatures(plan: PublicPlan): string[] {
  const features: string[] = [];
  for (const e of plan.entitlements) {
    if (e.key === "max_locations" && typeof e.value === "number") {
      features.push(`${e.value} location${e.value === 1 ? "" : "s"} included — additional locations available`);
    } else if (e.key === "max_businesses" && typeof e.value === "number") {
      features.push(`${e.value} businesses included — additional businesses available`);
    } else if (ENTITLEMENT_LABELS[e.key] && e.value === true) {
      features.push(ENTITLEMENT_LABELS[e.key]);
    }
  }
  if (plan.trialDays) features.unshift(`${plan.trialDays}-day free trial`);
  return features;
}

/**
 * Phase 28 — real pricing, read from the platform's own Plan catalog (GET /public/plans, a new
 * unauthenticated endpoint — see publicPlan.controller.ts) instead of a hardcoded, disconnected
 * array. Every number here is the SAME data BillingPage.tsx/AgencyBillingPage.tsx read — one
 * source of truth, never duplicated pricing constants.
 */
export function PricingPage() {
  usePageMeta({
    title: "Pricing — Tablecloth",
    description: "Simple, transparent pricing for restaurant online ordering. Start free, upgrade as you grow — no per-order commission.",
  });

  const { plans, error } = usePublicPlans();

  const ownerPlan = plans?.find((p) => p.type === "OWNER");
  const agencyPlan = plans?.find((p) => p.type === "AGENCY");

  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple pricing, built to grow with you"
          description="Pricing below is proposed and not yet finalized — final numbers are confirmed before you're ever charged."
        />
      </Section>

      <Section tone="surface">
        {error && (
          <Alert tone="danger" role="alert" className="mx-auto mb-6 max-w-xl">
            Couldn't load pricing right now — please try again shortly.
          </Alert>
        )}
        {!plans && !error ? (
          <p className="text-center text-sm text-muted">Loading pricing...</p>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
            {[ownerPlan, agencyPlan].filter((p): p is PublicPlan => Boolean(p)).map((plan) => (
              <Reveal key={plan.code}>
                <Card className="flex h-full flex-col gap-5">
                  <div>
                    <h3 className="font-heading text-xl font-semibold text-foreground">{plan.name}</h3>
                    <p className="mt-1 text-sm text-muted">{plan.description}</p>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-heading text-4xl font-semibold text-foreground">
                      {formatPlanPrice(plan.pricing, "monthly") ?? "Contact us"}
                    </span>
                    {formatPlanPrice(plan.pricing, "monthly") && <span className="text-sm text-muted">/month</span>}
                  </div>
                  {formatPlanPrice(plan.pricing, "yearly") && (
                    <p className="text-xs text-muted">or {formatPlanPrice(plan.pricing, "yearly")}/year</p>
                  )}
                  <ul className="flex flex-1 flex-col gap-2.5">
                    {planFeatures(plan).map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                        <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link to="/start-trial">
                    <Button className="w-full">Start free trial</Button>
                  </Link>
                </Card>
              </Reveal>
            ))}
          </div>
        )}
        <p className="mt-8 text-center text-xs text-muted">
          <Badge tone="warning" className="mr-1.5">
            Proposed pricing
          </Badge>
          Read live from the platform's plan catalog — not yet a final commercial sign-off. See{" "}
          <Link to="/contact" className="underline">
            contact us
          </Link>{" "}
          for volume/multi-location needs.
        </p>
      </Section>

      <Section>
        <SectionHeading eyebrow="Pricing FAQ" title="Common questions about plans" />
        <div className="mx-auto mt-10 grid max-w-3xl gap-3">
          {FAQS.map((item, i) => (
            <Reveal key={item.q} index={i % 4} className="rounded-xl border border-border bg-surface p-5">
              <p className="font-medium text-foreground">{item.q}</p>
              <p className="mt-1 text-sm text-muted">{item.a}</p>
            </Reveal>
          ))}
        </div>
      </Section>
    </>
  );
}
