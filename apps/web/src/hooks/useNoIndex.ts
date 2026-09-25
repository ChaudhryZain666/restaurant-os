import { useEffect } from "react";

/**
 * Belt-and-suspenders alongside robots.txt's Disallow list (Phase 12): robots.txt stops
 * crawling, but doesn't prevent a URL that's linked to from elsewhere from still appearing in
 * search results with no snippet — a real `noindex` meta tag on the page itself is what actually
 * guarantees that. Mirrors the one-off pattern MenuPage.tsx already used for `/r/:slug/t/:token`
 * QR routes; this generalizes it for every other private page (cart, orders, account, auth
 * forms, ...) rather than copy-pasting the same createElement/cleanup block on each one.
 *
 * `enabled` (default true, so every existing no-argument call site is unaffected) lets a caller
 * that's only CONDITIONALLY private — e.g. MenuPage.tsx's demo-restaurant storefront, which is a
 * real public route most of the time but should noindex specifically when the resolved restaurant
 * is the seeded sales-demo — toggle this without an extra hook/effect of its own.
 */
export function useNoIndex(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [enabled]);
}
