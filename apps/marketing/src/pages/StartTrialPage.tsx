import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { IconCheck } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";
import { ADMIN_START_URL, ADMIN_SIGNUP_URL } from "../lib/links";
import { ButtonLink } from "../components/ButtonLink";

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
    title: "Start Your Free Trial — GarnishTable",
    description: "Create your restaurant's branded storefront, add your menu, and start accepting online orders directly — no commission-hungry marketplace.",
  });
  return (
    <>
      <MarketingPageHero
        eyebrow="Start Free"
        title="Get your restaurant online without the complexity"
        description="Create your account and your restaurant goes live in minutes — no sales call, no credit card."
        hideCta
      />
      <Section>
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-2">
        <Reveal className="flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-semibold text-foreground">What's included</h2>
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
            <h2 className="font-heading text-lg font-semibold text-foreground">What happens when you sign up</h2>
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
            <h2 className="font-heading text-sm font-semibold text-foreground">About pricing &amp; trial length</h2>
            <p className="text-sm text-muted">
              No credit card required to start a trial. See{" "}
              <Link to="/pricing" className="font-medium text-primary hover:underline">
                Pricing
              </Link>{" "}
              for current plan details, or the{" "}
              <Link to="/faq" className="font-medium text-primary hover:underline">
                FAQ
              </Link>{" "}
              for more.
            </p>
          </div>

          <p className="text-sm text-muted">
            Curious what it looks like first? <Link to="/demo" className="text-primary underline underline-offset-2">Try the live demo</Link>.
          </p>
        </Reveal>
        <Reveal index={1} className="flex flex-col gap-8">
          <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-5">
            <h2 className="font-heading text-lg font-semibold text-foreground">Running a single restaurant?</h2>
            <p className="text-sm text-muted">
              Create your account, name your restaurant, and start your 14-day trial — no waiting on our team, no
              card required.
            </p>
            <ButtonLink href={ADMIN_SIGNUP_URL} className="w-full">Start my restaurant's trial</ButtonLink>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="font-heading text-lg font-semibold text-foreground">Running an agency?</h2>
            <p className="text-sm text-muted">
              Start your agency's trial directly — choose a plan, create your account, and you're in.
            </p>
            <ButtonLink href={ADMIN_START_URL} variant="outline" className="w-full">Start agency trial</ButtonLink>
          </div>
        </Reveal>
      </div>
      </Section>
    </>
  );
}
