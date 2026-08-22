import { Link } from "react-router-dom";
import { Badge, Button, Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconCheck } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";
import { FAQS } from "../lib/content";

const PLANS = [
  {
    name: "Starter",
    price: "$0",
    period: "while in trial",
    description: "For a single restaurant getting online ordering running for the first time.",
    features: ["Digital menu with photos & modifiers", "Online ordering — pickup & delivery", "Order management dashboard", "Basic analytics", "Knowledge base & support tickets"],
    cta: "Start Free Trial",
    highlighted: false,
  },
  {
    name: "Growth",
    price: "$79",
    period: "/month",
    description: "For restaurants ready to invest in repeat customers and deeper insight.",
    features: ["Everything in Starter", "Loyalty points program", "Full analytics & top-seller reporting", "Restaurant branding (logo, brand color)", "Priority support"],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Multi-location",
    price: "Custom",
    period: "talk to us",
    description: "For restaurant groups running more than one location.",
    features: ["Everything in Growth", "Multiple locations on one account", "Centralized reporting across locations", "Dedicated onboarding", "Custom contract terms"],
    cta: "Contact Sales",
    highlighted: false,
  },
];

export function PricingPage() {
  usePageMeta({
    title: "Pricing — Tablecloth",
    description: "Simple, transparent pricing for restaurant online ordering. Start free, upgrade as you grow — no per-order commission.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title="Simple pricing, built to grow with you"
          description="Illustrative pricing for this preview — final plans are confirmed when you start a trial."
        />
      </Section>

      <Section tone="surface">
        <div className="grid gap-6 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Reveal key={plan.name} className={plan.highlighted ? "lg:-mt-4" : ""}>
              <Card
                className={`flex h-full flex-col gap-5 ${
                  plan.highlighted ? "border-primary shadow-elevated ring-1 ring-primary" : ""
                }`}
              >
                {plan.highlighted && (
                  <Badge tone="warning" className="w-fit">
                    Most popular
                  </Badge>
                )}
                <div>
                  <h3 className="font-heading text-xl font-semibold text-foreground">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted">{plan.description}</p>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-heading text-4xl font-semibold text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted">{plan.period}</span>
                </div>
                <ul className="flex flex-1 flex-col gap-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-foreground/80">
                      <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link to={plan.cta === "Contact Sales" ? "/contact" : "/start-trial"}>
                  <Button className="w-full" variant={plan.highlighted ? "primary" : "outline"}>
                    {plan.cta}
                  </Button>
                </Link>
              </Card>
            </Reveal>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-muted">
          Demo pricing shown for illustration. No plan has been billed to anyone — this is a preview build.
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
