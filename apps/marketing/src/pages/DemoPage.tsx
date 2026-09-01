import { Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { LeadForm } from "../components/LeadForm";
import { STOREFRONT_URL } from "../lib/links";
import { IconArrowRight, IconHeadset, IconPalette, IconStore } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

// Phase 32 — the real, dedicated sales playground: theme switching, live customization, and a real
// (zero-money) checkout, all against the actual production storefront. This page no longer embeds
// the storefront in a raw iframe here (that pattern stays only where it's honest — a small
// preview screenshot-in-a-browser-chrome, not the primary demo experience) and no longer displays
// the real owner's login credentials in plaintext on a public page.
const EXPERIENCE_URL = `${STOREFRONT_URL}/r/demo-restaurant/experience`;

export function DemoPage() {
  usePageMeta({
    title: "Live Demo — Tablecloth",
    description: "Switch themes, customize the brand, and place a real order — try the actual Tablecloth product on a real restaurant.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Live demo"
          title="Play with a real restaurant, not a mockup"
          description="Switch its theme, change its colors, browse its real menu, and place a real (zero-cost) order — everything below is the actual product."
        />
      </Section>

      <Section tone="surface">
        <Reveal className="flex flex-col items-center gap-4 overflow-hidden rounded-2xl border border-border bg-surface p-8 text-center shadow-elevated sm:p-12">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <IconPalette className="h-6 w-6" />
          </span>
          <h3 className="font-heading text-2xl font-semibold text-foreground">Open the interactive playground</h3>
          <p className="max-w-lg text-sm text-muted">
            Cinematic, Luxury, Contemporary, Urban, or Minimal — pick a theme, adjust the brand colors, preview
            it on desktop and mobile, then order from it yourself.
          </p>
          <a
            href={EXPERIENCE_URL}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            Open the demo <IconArrowRight className="h-4 w-4" />
          </a>
          <span className="truncate text-xs text-muted">{EXPERIENCE_URL.replace("http://", "")}</span>
        </Reveal>
        <p className="mt-4 text-center text-xs text-muted">
          If this doesn't load, the demo storefront isn't running locally right now.
        </p>
      </Section>

      <Section id="help-center">
        <div className="grid gap-6 sm:grid-cols-2">
          <Reveal>
            <Card className="flex h-full flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconStore className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold text-foreground">Curious what the menu is really running on?</h3>
              <p className="text-sm text-muted">
                Every item, modifier, and price in the playground comes straight from the same menu system real
                restaurants manage from their dashboard — nothing about it is hand-built for the demo.
              </p>
              <a
                href={EXPERIENCE_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-auto flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Browse the menu <IconArrowRight className="h-3.5 w-3.5" />
              </a>
            </Card>
          </Reveal>
          <Reveal index={1}>
            <Card className="flex h-full flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconHeadset className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold text-foreground">Help Center</h3>
              <p className="text-sm text-muted">
                The support experience isn't a separate contact form — it's a searchable knowledge base and ticketing
                system built into the same ordering platform your customers already use.
              </p>
              <a
                href={`${STOREFRONT_URL}/support`}
                className="mt-auto flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open the help center <IconArrowRight className="h-3.5 w-3.5" />
              </a>
            </Card>
          </Reveal>
        </div>
      </Section>

      <Section tone="surface">
        <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-2">
          <Reveal className="flex flex-col gap-3">
            <h2 className="font-heading text-2xl font-semibold text-foreground">Prefer a guided walkthrough?</h2>
            <p className="text-sm text-muted">
              If self-serve isn't your style, tell us a bit about your restaurant and what you'd want to see — our
              team will follow up with a personalized walkthrough instead of pointing you at the demo credentials
              above.
            </p>
          </Reveal>
          <Reveal index={1}>
            <LeadForm
              submitLabel="Request a guided demo"
              successTitle="Thanks"
              successBody="Our team will reach out to schedule your walkthrough."
              qualification
            />
          </Reveal>
        </div>
      </Section>
    </>
  );
}
