import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Section } from "./Section";

const LEGAL_PAGES = [
  { label: "Terms of Service", to: "/terms" },
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Refund & Cancellation Policy", to: "/refund-policy" },
];

/**
 * Phase 77 — the shared shell for /terms, /privacy, /refund-policy. Deliberately NOT built from
 * Section/SectionHeading's marketing-page patterns (Reveal animations, centered eyebrow+title,
 * grid layouts) — a legal document is read carefully, not skimmed like a landing-page section, so
 * this renders as a single plain-prose column instead. Styles plain semantic HTML (h2/p/ul/li)
 * written directly in each page's content via one wrapper class, rather than introducing a
 * typography plugin for three pages.
 */
export function LegalPageLayout({
  title,
  lastUpdated,
  currentPath,
  children,
}: {
  title: string;
  lastUpdated: string;
  currentPath: string;
  children: ReactNode;
}) {
  return (
    <Section className="pt-14 sm:pt-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-heading text-3xl font-semibold text-foreground sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated {lastUpdated}</p>

        <div
          className="mt-10 [&_h2]:mb-3 [&_h2]:mt-9 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground
            [&_h2:first-child]:mt-0 [&_p]:mb-4 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:text-muted
            [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ul]:text-sm [&_ul]:text-muted
            [&_li]:leading-relaxed [&_strong]:text-foreground [&_a]:font-medium [&_a]:text-primary [&_a:hover]:underline"
        >
          {children}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted sm:flex-row sm:gap-4">
          <span className="font-medium text-foreground">Related:</span>
          {LEGAL_PAGES.filter((p) => p.to !== currentPath).map((p) => (
            <Link key={p.to} to={p.to} className="text-primary hover:underline">
              {p.label}
            </Link>
          ))}
        </div>
      </div>
    </Section>
  );
}
