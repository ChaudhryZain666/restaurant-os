import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button, Reveal } from "@restaurant/ui";
import { Container } from "./Container";
import { ObsidianGlowBackground } from "./ObsidianGlowBackground";

/**
 * The dark-chapter hero shell shared by the 9 non-Home marketing routes — Home keeps its own
 * bespoke hero (R3F backdrop, nav pull-up) unchanged; this is deliberately simpler, matching a
 * secondary page's lower visual weight. Self-contained: a literal `var(--gt-ink-fixed)` background
 * + raw white/opacity-white text, the same pattern Home's own ProductShowcase/JourneyRoute/Final CTA
 * already use — no `.theme-obsidian` ancestor required, so nothing else on the page is affected.
 *
 * Deliberately has no children/extra-content slot: a page's own hero-adjacent content (e.g.
 * ProductPage's LayerNavigator, SolutionsPage's anchor-pill nav) uses light-theme classes
 * (`text-foreground`, `border-border`, etc.) that would go invisible against this literal dark
 * background — those stay in their own unchanged light `<Section>` immediately below this one,
 * rather than being moved in here.
 */
export function MarketingPageHero({
  eyebrow,
  title,
  description,
  hideCta = false,
}: {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  hideCta?: boolean;
}) {
  return (
    <section className="relative isolate overflow-hidden" style={{ background: "var(--gt-ink-fixed)" }}>
      <ObsidianGlowBackground />
      <Container className="relative flex flex-col items-center gap-5 py-20 text-center sm:py-28">
        <Reveal className="flex flex-col items-center gap-5">
          <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-white/50">{eyebrow}</span>
          <h1 className="font-heading text-4xl font-semibold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p className="max-w-2xl text-lg text-white/75 sm:text-xl">{description}</p>
          {!hideCta && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <Link to="/start-trial">
                <Button size="lg">Start Free Trial</Button>
              </Link>
              <Link to="/demo">
                <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                  View Demo
                </Button>
              </Link>
            </div>
          )}
        </Reveal>
      </Container>
    </section>
  );
}
