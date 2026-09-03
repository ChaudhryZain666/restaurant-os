import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { FAQS } from "../lib/content";
import { usePageMeta } from "../hooks/usePageMeta";

/** FAQPage structured data makes this page eligible for a rich-result FAQ listing in search —
 *  built straight from the same FAQS content the page renders, never a separate copy. */
function useFaqStructuredData() {
  useEffect(() => {
    const data = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQS.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, []);
}

function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Reveal index={index % 5} className="overflow-hidden rounded-xl border border-border bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 p-5 text-left"
      >
        <span className="font-medium text-foreground">{q}</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`h-4 w-4 shrink-0 text-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <p className="px-5 pb-5 text-sm text-muted">{a}</p>}
    </Reveal>
  );
}

export function FaqPage() {
  usePageMeta({
    title: "FAQ — Tablecloth",
    description: "Answers to common questions about setting up and running online ordering with Tablecloth.",
  });
  useFaqStructuredData();
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading as="h1" eyebrow="FAQs" title="Frequently asked questions" description="Everything restaurant owners ask before signing up." />
      </Section>

      <Section tone="surface">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {FAQS.map((item, i) => (
            <FaqItem key={item.q} q={item.q} a={item.a} index={i} />
          ))}
        </div>
      </Section>

      <Section>
        <Reveal className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface p-10 text-center shadow-md">
          <h2 className="font-heading text-2xl font-semibold text-foreground">Still have questions?</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/contact">
              <Button variant="outline">Contact us</Button>
            </Link>
            <Link to="/start-trial">
              <Button>Start Free Trial</Button>
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
