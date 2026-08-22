import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { LeadForm } from "../components/LeadForm";
import { IconCheck } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

const INCLUDED = [
  "Your own branded restaurant storefront",
  "Digital menu — categories, photos, sizes and add-ons",
  "Online ordering, pickup and delivery",
  "Order management dashboard for your team",
  "Customer accounts, order history and loyalty points",
  "Your own discount/promo codes",
  "Analytics — revenue, orders, top sellers",
  "Built-in help center and support tickets",
];

const STEPS = [
  { title: "Create your restaurant", description: "Tell us your restaurant's name, cuisine and location." },
  { title: "Add your menu", description: "Categories, items, photos, prices, sizes and add-ons." },
  { title: "Customize your storefront", description: "Logo, cover image and brand color — it looks like yours, not a template." },
  { title: "Start accepting orders", description: "Your ordering page goes live and customers can order directly." },
];

export function StartTrialPage() {
  usePageMeta({
    title: "Start Your Free Trial — Tablecloth",
    description: "Create your restaurant's branded storefront, add your menu, and start accepting online orders directly — no commission-hungry marketplace.",
  });
  return (
    <Section className="pt-14 sm:pt-20">
      <SectionHeading
        eyebrow="Start Free"
        title="Get your restaurant online without the complexity"
        description="Tell us a bit about your restaurant — our team will follow up to finish setting up your ordering page."
      />
      <div className="mx-auto mt-12 grid max-w-5xl gap-10 lg:grid-cols-2">
        <Reveal className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-lg font-semibold text-foreground">What's included</h3>
            <ul className="flex flex-col gap-2.5">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-foreground/80">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-3">
            <h3 className="font-heading text-lg font-semibold text-foreground">What happens when you sign up</h3>
            <ol className="flex flex-col gap-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex items-start gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{step.title}</p>
                    <p className="text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
            <h3 className="font-heading text-sm font-semibold text-foreground">About pricing &amp; trial length</h3>
            <p className="text-sm text-muted">
              No credit card required to start — there's no billing set up yet, so there's nothing to charge. We're
              still finalizing formal plans and trial length; every restaurant we onboard today runs free, and we'll
              talk to you directly, before anything ever changes. Cancelling is as simple as asking us to.
            </p>
            <p className="text-xs text-muted">
              See{" "}
              <Link to="/pricing" className="font-medium text-primary hover:underline">
                Pricing
              </Link>{" "}
              for the plans we're designing toward, or the{" "}
              <Link to="/faq" className="font-medium text-primary hover:underline">
                FAQ
              </Link>{" "}
              for more detail.
            </p>
          </div>

          <p className="text-sm text-muted">
            Curious what it looks like first? <Link to="/demo" className="text-primary hover:underline">Try the live demo</Link>.
          </p>
        </Reveal>
        <Reveal index={1}>
          <LeadForm
            submitLabel="Start Free Trial"
            successTitle="Thanks"
            successBody="Our team will be in touch shortly to finish setting up your restaurant's ordering page."
            qualification
          />
        </Reveal>
      </div>
    </Section>
  );
}
