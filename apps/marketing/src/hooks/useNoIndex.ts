import { useEffect } from "react";

/**
 * Phase 79 (second pass) — this app had no noindex mechanism at all, unlike apps/web's
 * useNoIndex.ts, because every one of its 13 routes was meant to be indexable. The one exception
 * is the new catch-all NotFoundPage (App.tsx's `path="*"`): an unmatched marketing URL should
 * never accumulate in search results with generic/stale metadata. Mirrors apps/web's hook exactly.
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
