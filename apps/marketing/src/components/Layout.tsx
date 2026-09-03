import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

/**
 * Organization + WebSite structured data describes the site itself, not any one page — injected
 * once here (Layout mounts once for the whole app) rather than per-page like usePageMeta's
 * title/description tags, so it's never duplicated across route changes.
 */
function useSiteStructuredData() {
  useEffect(() => {
    const data = {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          name: "Tablecloth",
          url: window.location.origin,
          logo: `${window.location.origin}/favicon.svg`,
        },
        {
          "@type": "WebSite",
          name: "Tablecloth",
          url: window.location.origin,
        },
      ],
    };
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
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
    </div>
  );
}
