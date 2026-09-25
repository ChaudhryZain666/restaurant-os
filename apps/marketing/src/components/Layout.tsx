import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { applyJsonLd } from "@restaurant/utils/seoMeta";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { BackToTop } from "./BackToTop";

/**
 * Organization + WebSite structured data describes the site itself, not any one page — injected
 * once here (Layout mounts once for the whole app) rather than per-page like usePageMeta's
 * title/description tags, so it's never duplicated across route changes.
 */
function useSiteStructuredData() {
  useEffect(() => {
    const base: string = import.meta.env.VITE_SITE_URL ?? window.location.origin;
    return applyJsonLd({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "GarnishTable",
          url: base,
          logo: `${base}/favicon.svg`,
        },
        {
          "@type": "WebSite",
          name: "GarnishTable",
          url: base,
        },
      ],
    });
  }, []);
}

export function Layout() {
  useSiteStructuredData();
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Nav />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <BackToTop />
    </div>
  );
}
