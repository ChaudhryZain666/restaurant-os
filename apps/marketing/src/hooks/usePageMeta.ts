import { useEffect } from "react";
import { applySeoMeta } from "@restaurant/utils/seoMeta";

interface PageMeta {
  title: string;
  description: string;
}

/**
 * index.html only ships one static title/description (the homepage's) — without this, every
 * other route in this client-rendered SPA keeps showing that same tag forever after a client-side
 * navigation, and a shared link to /pricing or /product would preview as the homepage.
 *
 * Phase 79 — thin wrapper around the shared `applySeoMeta` (packages/utils/src/seoMeta.ts), which
 * unifies this hook's original DOM logic with apps/web's MenuPage.tsx equivalent; both apps now go
 * through the same tag mechanics. og:image intentionally falls back to the site favicon (the only
 * real image asset that exists in this app today) rather than a fabricated screenshot — a
 * dedicated 1200x630 social preview image is real, valuable follow-up work, not something to fake
 * a URL for here.
 *
 * `VITE_SITE_URL` (Phase 79) lets a deployment override the origin used for canonical/og:url/
 * og:image once a real production domain exists — unset, this falls back to
 * `window.location.origin` exactly as before, so nothing changes for local dev or an unconfigured
 * deployment. Same env-override pattern already established in `lib/links.ts`.
 */
export function usePageMeta({ title, description }: PageMeta): void {
  useEffect(() => {
    const base: string = import.meta.env.VITE_SITE_URL ?? window.location.origin;
    const url = `${base}${window.location.pathname}`;

    return applySeoMeta({
      title,
      description,
      canonicalUrl: url,
      og: {
        title,
        description,
        type: "website",
        url,
        siteName: "GarnishTable",
        image: `${base}/favicon.svg`,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    });
  }, [title, description]);
}
