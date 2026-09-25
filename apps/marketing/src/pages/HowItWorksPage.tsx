import { Reveal } from "@restaurant/ui";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { StepList } from "../components/StepList";
import { usePageMeta } from "../hooks/usePageMeta";

export function HowItWorksPage() {
  usePageMeta({
    title: "How It Works — GarnishTable",
    description: "From signup to your first order in six steps — no developer required, no separate website to maintain.",
  });
  return (
    <>
      <MarketingPageHero
        eyebrow="How it works"
        title="From signup to your first order"
        description="Six steps. No developer required, no separate website to maintain."
      />

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

      <MarketingClosingCta
        title="See the real thing before you sign up"
        description="Six steps, no developer required — or just watch the real product run first."
      />
    </>
  );
}
