import { Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { LeadForm } from "../components/LeadForm";
import { ADMIN_LOGIN_URL, STOREFRONT_URL } from "../lib/links";
import { IconArrowRight, IconHeadset, IconStore } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

export function DemoPage() {
  usePageMeta({
    title: "Live Demo — Tablecloth",
    description: "Browse categories, open an item, pick modifiers, add to cart and check out — try the real Tablecloth ordering experience.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Live demo"
          title="This is the real product, not a mockup"
          description="Browse categories, open an item, pick modifiers, add to cart, and check out — exactly what your customers would do."
        />
      </Section>

      <Section tone="surface">
        <Reveal className="overflow-hidden rounded-2xl border border-border bg-surface shadow-elevated">
          <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/60" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/60" />
            </div>
            <span className="truncate text-xs text-muted">{STOREFRONT_URL.replace("http://", "")}</span>
            <a
              href={STOREFRONT_URL}
              target="_blank"
              rel="noreferrer"
              className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open in new tab <IconArrowRight className="h-3 w-3" />
            </a>
          </div>
          <iframe
            src={STOREFRONT_URL}
            title="Live demo restaurant"
            className="h-[720px] w-full border-0"
            loading="lazy"
          />
        </Reveal>
        <p className="mt-4 text-center text-xs text-muted">
          If this doesn't load, the demo storefront isn't running locally right now —{" "}
          <a href={STOREFRONT_URL} className="text-primary hover:underline">
            open it directly
          </a>{" "}
          instead.
        </p>
      </Section>

      <Section id="help-center">
        <div className="grid gap-6 sm:grid-cols-2">
          <Reveal>
            <Card className="flex h-full flex-col gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <IconStore className="h-5 w-5" />
              </span>
              <h3 className="font-heading text-lg font-semibold text-foreground">Want to see the owner's side?</h3>
              <p className="text-sm text-muted">
                Log into the restaurant dashboard with the demo owner account and see the menu, orders and settings the
                storefront above is actually reading from.
              </p>
              <div className="mt-auto rounded-lg border border-border bg-background p-3 text-xs text-muted">
                <p>
                  <span className="font-medium text-foreground">Email:</span> owner@demo-restaurant.local
                </p>
                <p>
                  <span className="font-medium text-foreground">Password:</span> Owner123!
                </p>
              </div>
              <a href={ADMIN_LOGIN_URL} className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                Open owner dashboard <IconArrowRight className="h-3.5 w-3.5" />
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
