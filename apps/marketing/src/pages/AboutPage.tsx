import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconArrowRight, IconHeadset, IconPalette, IconStore } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

const VALUES = [
  { title: "Restaurants first", description: "Every decision starts with what actually helps a restaurant sell more direct orders — not what looks good on a features list.", icon: IconStore },
  { title: "Own your brand", description: "We build ordering software, not a marketplace listing. Your restaurant's identity stays yours.", icon: IconPalette },
  { title: "Support that answers", description: "A built-in help center and ticketing system, because restaurant owners don't have time to chase down support.", icon: IconHeadset },
];

export function AboutPage() {
  usePageMeta({
    title: "About — Tablecloth",
    description: "Tablecloth is a focused online ordering platform built for restaurants that want to own their ordering experience — not a marketplace.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Company"
          title="Built for restaurants that want to own their ordering experience"
          description="Tablecloth is a focused online ordering platform — not a marketplace, not a website builder. Just the tools a restaurant actually needs to sell direct."
        />
      </Section>

      <Section tone="surface">
        <div className="grid gap-6 sm:grid-cols-3">
          {VALUES.map((value, i) => (
            <Reveal key={value.title} index={i} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-6">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <value.icon className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold text-foreground">{value.title}</h3>
              <p className="text-sm text-muted">{value.description}</p>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section>
        <Reveal className="mx-auto flex max-w-2xl flex-col gap-4 text-center">
          <h2 className="font-heading text-2xl font-semibold text-foreground">Why we exist</h2>
          <p className="text-muted">
            Third-party marketplaces made it easy for restaurants to get discovered — and expensive to keep every order
            after that. We think restaurants deserve an ordering experience that looks and feels like theirs, keeps the
            customer relationship, and doesn't take a cut of every direct sale. That's the entire product.
          </p>
        </Reveal>
      </Section>

      <Section tone="dark">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-heading text-3xl font-semibold text-secondary-foreground">Want to talk it through?</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/contact">
              <Button size="lg" variant="secondary">
                Contact us
              </Button>
            </Link>
            <Link to="/start-trial">
              <Button size="lg" variant="outline" className="border-white/30 text-secondary-foreground hover:bg-white/10">
                Start Free Trial <IconArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
