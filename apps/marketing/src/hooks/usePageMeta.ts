import { useEffect } from "react";

interface PageMeta {
  title: string;
  description: string;
}

/**
 * index.html only ships one static title/description (the homepage's) — without this, every
 * other route in this client-rendered SPA keeps showing that same tag forever after a client-side
 * navigation, and a shared link to /pricing or /product would preview as the homepage. Mirrors
 * apps/web's per-page pattern (see MenuPage.tsx's document.title/meta effect and the generalized
 * useNoIndex hook) rather than pulling in a head-management library for ten static pages.
 *
 * Extended to match apps/web's MenuPage.tsx SEO tag set (og:type/og:url/twitter:card, not just
 * og:title/og:description) — the two apps now emit the same shape of social metadata, just for
 * static marketing pages here instead of per-restaurant storefronts there. og:image intentionally
 * falls back to the site favicon (the only real image asset that exists in this app today) rather
 * than a fabricated screenshot — a dedicated 1200x630 social preview image is real, valuable
 * follow-up work, not something to fake a URL for here.
 */
export function usePageMeta({ title, description }: PageMeta): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;
    const url = `${window.location.origin}${window.location.pathname}`;
    const created: HTMLElement[] = [];

    function addMeta(attr: "name" | "property", key: string, content: string) {
      const meta = document.createElement("meta");
      meta.setAttribute(attr, key);
      meta.content = content;
      document.head.appendChild(meta);
      created.push(meta);
    }

    // index.html ships one static <meta name="description"> (the homepage's, for a useful default
    // before React hydrates). Creating a second one here left the static tag first in DOM order —
    // any querySelector/crawler reading "the" description tag kept getting the homepage's text on
    // every other route. Updating that existing tag in place (and restoring it on cleanup) instead
    // of appending a duplicate fixes that for real, not just for this hook's own bookkeeping.
    const descriptionTag = document.querySelector('meta[name="description"]');
    let previousDescription: string | null = null;
    if (descriptionTag) {
      previousDescription = descriptionTag.getAttribute("content");
      descriptionTag.setAttribute("content", description);
    } else {
      addMeta("name", "description", description);
    }

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = url;
    document.head.appendChild(canonical);
    created.push(canonical);

    addMeta("property", "og:title", title);
    addMeta("property", "og:description", description);
    addMeta("property", "og:type", "website");
    addMeta("property", "og:url", url);
    addMeta("property", "og:site_name", "Tablecloth");
    addMeta("property", "og:image", `${window.location.origin}/favicon.svg`);

    addMeta("name", "twitter:card", "summary");
    addMeta("name", "twitter:title", title);
    addMeta("name", "twitter:description", description);

    return () => {
      document.title = previousTitle;
      if (descriptionTag && previousDescription !== null) {
        descriptionTag.setAttribute("content", previousDescription);
      }
      for (const el of created) document.head.removeChild(el);
    };
  }, [title, description]);
}
