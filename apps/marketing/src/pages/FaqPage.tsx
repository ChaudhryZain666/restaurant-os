import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Reveal } from "@restaurant/ui";
import { applyJsonLd } from "@restaurant/utils/seoMeta";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { ObsidianGlowBackground } from "../components/ObsidianGlowBackground";
import { Container } from "../components/Container";
import { FaqItem } from "../components/FaqItem";
import { FAQS } from "../lib/content";
import { usePageMeta } from "../hooks/usePageMeta";
import { ButtonLink } from "../components/ButtonLink";

/** FAQPage structured data makes this page eligible for a rich-result FAQ listing in search —
 *  built straight from the same FAQS content the page renders, never a separate copy. */
function useFaqStructuredData() {
  useEffect(
    () =>
      applyJsonLd({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: FAQS.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }, "faq"),
    []
  );
}

export function FaqPage() {
  usePageMeta({
    title: "Restaurant Online Ordering FAQ — GarnishTable",
    description:
      "Straight answers about GarnishTable's restaurant online ordering: branded ordering page, orders and notes, pickup and delivery, pricing, free trial, payments and integrations.",
  });
  useFaqStructuredData();
  return (
    <>
      <MarketingPageHero
        eyebrow="FAQs"
        title="Restaurant online ordering: frequently asked questions"
        description="Straight answers to what restaurant owners ask before signing up, including what GarnishTable doesn't do yet."
      />

      <Section tone="surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <h2 className="sr-only">All questions</h2>
          {FAQS.map((item, i) => (
            <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
          ))}
          <p className="mt-6 text-sm text-muted">
            More detail: <Link to="/pricing" className="underline">pricing</Link>,{" "}
            <Link to="/how-it-works" className="underline">how setup works</Link>,{" "}
            <Link to="/guides" className="underline">restaurant guides</Link> and the{" "}
            <Link to="/demo" className="underline">live demo</Link>.
          </p>
        </div>
      </Section>

      {/* Deliberately not <MarketingClosingCta> — a lingering-question visitor is better served by
          a path to Contact than to View Demo, so this keeps its own distinct CTA pair while still
          matching the dark bookend treatment every other page's closing section now has. */}
      <section className="relative isolate overflow-hidden py-20 sm:py-28" style={{ background: "var(--gt-ink-fixed)" }}>
        <ObsidianGlowBackground />
        <Container>
          <Reveal variant="scale" className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
            <h2 className="font-heading text-4xl font-semibold text-white sm:text-5xl">Still have questions?</h2>
            <p className="max-w-xl text-white/65">We're happy to walk through anything that's not covered here.</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <ButtonLink to="/contact" size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">Contact us</ButtonLink>
              <ButtonLink to="/start-trial" size="lg">Start Free Trial</ButtonLink>
            </div>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
