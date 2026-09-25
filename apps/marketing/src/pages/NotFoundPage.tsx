import { Link } from "react-router-dom";
import { Button } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { usePageMeta } from "../hooks/usePageMeta";
import { useNoIndex } from "../hooks/useNoIndex";

/**
 * Phase 79 (second pass) — this app previously had no catch-all route at all: an unmatched URL
 * (typo, dead external link, stale bookmark) rendered nothing (`<Routes>` with no matching child
 * and no `path="*"`), a blank page that a static-hosting SPA fallback would still serve with an
 * HTTP 200 — exactly the "404 behavior accidentally becomes indexable content" failure mode. This
 * gives unmatched URLs a real page with real content, marked noindex.
 */
export function NotFoundPage() {
  usePageMeta({
    title: "Page not found — GarnishTable",
    description: "The page you're looking for doesn't exist or may have moved.",
  });
  useNoIndex();

  return (
    <Section className="pt-14 sm:pt-20">
      <SectionHeading
        as="h1"
        eyebrow="404"
        title="We couldn't find that page"
        description="The link may be outdated, or the page may have moved. Here are a few places to start instead."
      />
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to="/">
          <Button>Back to homepage</Button>
        </Link>
        <Link to="/contact">
          <Button variant="outline">Contact us</Button>
        </Link>
      </div>
    </Section>
  );
}
