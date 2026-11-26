import { Section } from "../components/Section";
import { MarketingPageHero } from "../components/MarketingPageHero";
import { MarketingClosingCta } from "../components/MarketingClosingCta";
import { usePageMeta } from "../hooks/usePageMeta";
import { COMPARISONS, type Comparison } from "../lib/comparisons";

const bySlug = (slug: string) => COMPARISONS.find((c) => c.slug === slug)!;
export const CompareChowNowPage = () => <ComparisonPage comparison={bySlug("chownow")} />;
export const CompareRestolabsPage = () => <ComparisonPage comparison={bySlug("restolabs")} />;

/** /compare/<slug> — an honest, sourced comparison (data and rules: lib/comparisons.ts). */
export function ComparisonPage({ comparison: c }: { comparison: Comparison }) {
  usePageMeta({ title: c.title, description: c.description });
  return (
    <>
      <MarketingPageHero eyebrow="Compare" title={c.h1} description={c.answer} />

      <Section tone="surface">
        <h2 className="font-heading text-2xl font-semibold text-foreground">Side by side</h2>
        <p className="mt-2 text-sm text-muted">
          {c.competitor} facts are from {c.competitor}'s own public pages, checked on {c.checkedOn}. Prices and terms change, so
          check the sources below before deciding.
        </p>
        {/* Phones: one card per row, so both answers are visible without sideways scrolling. */}
        <dl className="mt-6 flex flex-col gap-3 md:hidden">
          {c.rows.map((r) => (
            <div key={r.label} className="rounded-xl border border-border bg-background p-4 text-sm">
              <dt className="font-semibold text-foreground">{r.label}</dt>
              <dd className="mt-2 text-muted">
                <span className="font-medium text-foreground">GarnishTable: </span>
                {r.garnishtable}
              </dd>
              <dd className="mt-1 text-muted">
                <span className="font-medium text-foreground">{c.competitor}: </span>
                {r.competitor}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 hidden overflow-x-auto rounded-xl border border-border md:block">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-background">
              <tr>
                <th scope="col" className="p-3 font-semibold text-foreground"> </th>
                <th scope="col" className="p-3 font-semibold text-foreground">GarnishTable</th>
                <th scope="col" className="p-3 font-semibold text-foreground">{c.competitor}</th>
              </tr>
            </thead>
            <tbody>
              {c.rows.map((r) => (
                <tr key={r.label} className="border-t border-border align-top">
                  <th scope="row" className="p-3 font-medium text-foreground">{r.label}</th>
                  <td className="p-3 text-muted">{r.garnishtable}</td>
                  <td className="p-3 text-muted">{r.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">When GarnishTable is the better fit</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
              {c.chooseGarnishTable.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
          <div>
            <h2 className="font-heading text-xl font-semibold text-foreground">When {c.competitor} is the better fit</h2>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-muted">
              {c.chooseCompetitor.map((x) => <li key={x}>{x}</li>)}
            </ul>
          </div>
        </div>
        <div className="mt-10 text-sm text-muted">
          <h2 className="font-heading text-base font-semibold text-foreground">Sources</h2>
          <ul className="mt-2 space-y-1">
            {c.sources.map((s) => (
              <li key={s.url}>
                {s.label}:{" "}
                <a href={s.url} rel="nofollow noopener" target="_blank" className="text-primary hover:underline">
                  {s.url}
                </a>{" "}
                (checked {c.checkedOn})
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <MarketingClosingCta
        title="Try GarnishTable free for 14 days"
        description="No card needed. Or see it running on a real restaurant first."
      />
    </>
  );
}
