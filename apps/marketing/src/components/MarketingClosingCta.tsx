import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Logo, Reveal } from "@restaurant/ui";
import { Container } from "./Container";
import { ObsidianGlowBackground } from "./ObsidianGlowBackground";

/**
 * The dark-chapter closing CTA shared by the 9 non-Home marketing routes — structurally the same
 * as HomePage.tsx's own Final CTA (logo mark, headline, the same Start Free Trial / View Demo pair,
 * the same trust-indicator row), reused verbatim rather than reinvented so every page on the site
 * ends on the identical, already-converged CTA moment. `title`/`description` are per-page — short,
 * specific copy, never a literal copy-paste of Home's own.
 */
export function MarketingClosingCta({ title, description }: { title: ReactNode; description: ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden py-20 sm:py-28" style={{ background: "var(--gt-ink-fixed)" }}>
      <ObsidianGlowBackground />
      <Container>
        <Reveal variant="scale" className="relative mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          <Logo hideText size="lg" variant="light" />
          <h2 className="font-heading text-4xl font-semibold text-white sm:text-5xl">{title}</h2>
          <p className="max-w-xl text-white/65">{description}</p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
            <Link to="/start-trial">
              <Button size="lg">Start Free Trial</Button>
            </Link>
            <Link to="/demo">
              <Button size="lg" variant="outline" className="border-white/30 text-white hover:bg-white/10">
                View Demo
              </Button>
            </Link>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> No commission on direct orders
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> 14-day trial, no card required
            </span>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
