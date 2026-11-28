import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { usePageMeta } from "../hooks/usePageMeta";
import { GUIDES } from "../lib/guides";

/** /guides: the index of practical articles for restaurant owners (lib/guides.ts). */
export function GuidesPage() {
  usePageMeta({
    title: "Restaurant Online Ordering Guides — GarnishTable",
    description:
      "Practical guides for restaurant owners: setting up online ordering, choosing a system, direct ordering vs delivery apps, and managing orders in one dashboard.",
  });
  return (
    <>
      <MarketingPageHero
        eyebrow="Guides"
        title="Restaurant online ordering guides"
        description="Plain-language guides for independent restaurant owners: how online ordering works, what to look for and how to run it day to day."
      />
      <Section tone="surface">
        <h2 className="sr-only">All guides</h2>
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-2">
          {GUIDES.map((g, i) => (
            <Reveal key={g.slug} index={i % 2} className="flex flex-col gap-2 rounded-xl border border-border bg-background p-6">
              <h3 className="font-heading text-lg font-semibold text-foreground">
                <Link to={`/guides/${g.slug}`} className="hover:underline">
                  {g.h1}
                </Link>
              </h3>
              <p className="text-sm text-muted">{g.description}</p>
              <Link to={`/guides/${g.slug}`} className="mt-auto pt-2 text-sm font-medium text-primary hover:underline">
                Read the guide<span className="sr-only">: {g.h1}</span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Section>
      <MarketingClosingCta
        title="See it on a real restaurant"
        description="The live demo runs the real product on a sample restaurant. Place an order and watch it arrive."
      />
    </>
  );
}
