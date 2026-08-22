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
 */
export function usePageMeta({ title, description }: PageMeta): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    const meta = document.createElement("meta");
    meta.name = "description";
    meta.content = description;
    document.head.appendChild(meta);

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = `${window.location.origin}${window.location.pathname}`;
    document.head.appendChild(canonical);

    const ogTitle = document.createElement("meta");
    ogTitle.setAttribute("property", "og:title");
    ogTitle.content = title;
    document.head.appendChild(ogTitle);

    const ogDescription = document.createElement("meta");
    ogDescription.setAttribute("property", "og:description");
    ogDescription.content = description;
    document.head.appendChild(ogDescription);

    return () => {
      document.title = previousTitle;
      document.head.removeChild(meta);
      document.head.removeChild(canonical);
      document.head.removeChild(ogTitle);
      document.head.removeChild(ogDescription);
    };
  }, [title, description]);
}
