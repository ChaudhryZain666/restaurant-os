import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { StepList } from "../components/StepList";
import { usePageMeta } from "../hooks/usePageMeta";

export function HowItWorksPage() {
  usePageMeta({
    title: "How Restaurant Online Ordering Works — GarnishTable",
    description:
      "How to go from signup to your first online order with GarnishTable: create your account, add your menu, brand your page, choose order types, test and share.",
  });
  return (
    <>
      <MarketingPageHero
        eyebrow="How it works"
        title="How restaurant online ordering works, from signup to your first order"
        description="Six steps you do yourself from the dashboard. No developer needed and no separate website to maintain."
      />

      <Section tone="surface">
        <h2 className="sr-only">The six steps</h2>
        <StepList />
      </Section>

      <Section>
        <div className="grid gap-8 lg:grid-cols-3">
          <Reveal className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">What you'll need</h3>
            <p className="text-sm text-muted">Your restaurant's name and address, your menu (a website, PDF or photos to import, or a list to type in), your opening hours, and your logo if you have one.</p>
          </Reveal>
          <Reveal index={1} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">What takes the most time</h3>
            <p className="text-sm text-muted">The menu. Import saves typing, but you still check every item, price and option before going live. A short menu can be ready the same day.</p>
          </Reveal>
          <Reveal index={2} className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-6">
            <h3 className="font-heading text-lg font-semibold text-foreground">What happens after</h3>
            <p className="text-sm text-muted">Orders land in your dashboard with the customer's notes. Accept, prepare and complete them as they come in. Customers pay you directly at pickup, on delivery or at the table.</p>
          </Reveal>
        </div>
        <p className="mt-10 text-center text-sm text-muted">
          Next: <Link to="/pricing" className="underline">compare plans</Link>,{" "}
          <Link to="/demo" className="underline">try the live demo</Link>,{" "}
          <Link to="/faq" className="underline">read the FAQ</Link>,{" "}
          <Link to="/guides/set-up-online-ordering-for-your-restaurant" className="underline">read the full setup guide</Link> or{" "}
          <Link to="/start-trial" className="underline">start your free trial</Link>.
        </p>
      </Section>

      <MarketingClosingCta
        title="See the real thing before you sign up"
        description="Six steps, no developer required — or just watch the real product run first."
      />
    </>
  );
}
