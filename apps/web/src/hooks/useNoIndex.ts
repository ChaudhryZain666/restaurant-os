import { useEffect } from "react";

/**
 * Belt-and-suspenders alongside robots.txt's Disallow list (Phase 12): robots.txt stops
 * crawling, but doesn't prevent a URL that's linked to from elsewhere from still appearing in
 * search results with no snippet — a real `noindex` meta tag on the page itself is what actually
 * guarantees that. Mirrors the one-off pattern MenuPage.tsx already used for `/r/:slug/t/:token`
 * QR routes; this generalizes it for every other private page (cart, orders, account, auth
 * forms, ...) rather than copy-pasting the same createElement/cleanup block on each one.
 */
export function useNoIndex(): void {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}
