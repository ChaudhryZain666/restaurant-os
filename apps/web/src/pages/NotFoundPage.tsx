import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@restaurant/ui";
import { useNoIndex } from "../hooks/useNoIndex";

/**
 * Phase 79 (second pass) — this app previously had no catch-all route: an unmatched URL (one that
 * isn't `/r/:slug/*` and isn't one of the explicitly-listed bare legacy paths) rendered nothing at
 * all, since <Layout>'s child <Route>s only render when one of them actually matches. A blank page
 * with an HTTP 200 from the static-hosting SPA fallback is exactly the "404 accidentally becomes
 * indexable" failure mode this phase's own audit flagged. A bad/unknown `/r/:slug` (a real slug
 * pattern that fails to resolve) is handled separately by Layout.tsx's own `restaurantNotFound`
 * state, not this page.
 */
export function NotFoundPage() {
  useNoIndex();
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Page not found";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-16 text-center">
      <h1 className="font-heading text-3xl font-semibold text-foreground">Page not found</h1>
      <p className="text-muted">The page you're looking for doesn't exist or may have moved.</p>
      <Link to="/">
        <Button>Back to home</Button>
      </Link>
    </div>
  );
}
