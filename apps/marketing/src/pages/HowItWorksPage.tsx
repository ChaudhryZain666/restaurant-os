import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { StepList } from "../components/StepList";
import { IconArrowRight } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

export function HowItWorksPage() {
  usePageMeta({
    title: "How It Works — Tablecloth",
    description: "From signup to your first order in six steps — no developer required, no separate website to maintain.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="How it works"
          title="From signup to your first order"
          description="Six steps. No developer required, no separate website to maintain."
        />
      </Section>

      <Section tone="surface">
        <StepList />
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-3">
          <Reveal className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">What you'll need</h3>
            <p className="text-sm text-muted">Your restaurant's name, address, a menu (even a rough one to start), and your logo if you have one.</p>
          </Reveal>
          <Reveal index={1} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">How long it takes</h3>
            <p className="text-sm text-muted">Most restaurants have a working menu published the same day they sign up.</p>
          </Reveal>
          <Reveal index={2} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">What happens after</h3>
            <p className="text-sm text-muted">Orders land straight in your dashboard — accept, prepare, and complete them as they come in.</p>
          </Reveal>
        </div>
      </Section>

      <Section tone="dark">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-heading text-3xl font-semibold text-secondary-foreground">See the real thing before you sign up</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/demo">
              <Button size="lg" variant="secondary">
                Try the live demo
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
