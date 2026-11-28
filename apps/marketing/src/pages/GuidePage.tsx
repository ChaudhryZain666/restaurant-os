import { Link, useLocation } from "react-router-dom";
import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { ButtonLink } from "../components/ButtonLink";
import { usePageMeta } from "../hooks/usePageMeta";
import { GUIDES, guideBySlug, type Guide } from "../lib/guides";
import { NotFoundPage } from "./NotFoundPage";

/** /guides/<slug>: one article (content and rules: lib/guides.ts). App.tsx lists each guide's
 *  path explicitly so nginx and the router agree on exactly which URLs exist (routes.test.mjs). */
export function GuideRoute() {
  const slug = useLocation().pathname.replace(/^\/guides\//, "").replace(/\/$/, "").toLowerCase();
  const guide = guideBySlug(slug);
  return guide ? <GuidePage guide={guide} /> : <NotFoundPage />;
}

export function GuidePage({ guide: g }: { guide: Guide }) {
  usePageMeta({ title: g.title, description: g.description });
  const others = GUIDES.filter((x) => x.slug !== g.slug);
  return (
    <>
      <MarketingPageHero eyebrow="Guide" title={g.h1} description={`Updated ${g.updated}`} />

      <Section tone="surface">
        <article className="mx-auto flex max-w-3xl flex-col gap-10">
          <div className="rounded-xl border border-border bg-background p-6">
            <h2 className="font-heading text-lg font-semibold text-foreground">The short answer</h2>
            <p className="mt-2 text-base leading-relaxed text-foreground/85">{g.answer}</p>
          </div>

          {g.sections.map((s) => (
            <section key={s.heading} className="flex flex-col gap-3">
              <h2 className="font-heading text-2xl font-semibold text-foreground">{s.heading}</h2>
              {s.paragraphs?.map((p) => (
                <p key={p.slice(0, 40)} className="leading-relaxed text-foreground/80">
                  {p}
                </p>
              ))}
              {s.items && (
                <ul className="flex list-disc flex-col gap-1.5 pl-5 text-foreground/80">
                  {s.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <nav aria-label="Related pages" className="rounded-xl border border-border bg-background p-6">
            <h2 className="font-heading text-lg font-semibold text-foreground">Keep reading</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              {g.related.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="font-medium text-primary underline-offset-4 hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
              {others.map((o) => (
                <li key={o.slug}>
                  <Link to={`/guides/${o.slug}`} className="font-medium text-primary underline-offset-4 hover:underline">
                    {o.h1}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-wrap gap-3">
            <ButtonLink to="/start-trial">Start your 14-day free trial</ButtonLink>
            <ButtonLink to="/demo" variant="secondary">See the live demo</ButtonLink>
          </div>
        </article>
      </Section>

      <MarketingClosingCta
        title="Try direct online ordering for 14 days"
        description="Set up your menu, place a test order and see it arrive in your dashboard. No card required to start."
      />
    </>
  );
}
