import { useEffect, useState } from "react";

/**
 * Phase 33 — tracks whether the page has scrolled past `threshold`, for themes whose navigation is
 * transparent over the hero and solidifies once the visitor scrolls (Cinematic, Contemporary). This
 * is DOM/presentation state, not business data — a theme Header owning its own scroll-derived visual
 * state doesn't touch CartContext/AuthContext/the API, so it stays within the existing component
 * contract (apps/web/src/theme/types.ts's doc comment: never call the API, never make an ordering
 * decision — scroll position is neither).
 */
export function useScrolled(threshold = 40): boolean {
  const [scrolled, setScrolled] = useState(() => (typeof window !== "undefined" ? window.scrollY > threshold : false));

  useEffect(() => {
    function handleScroll() {
      setScrolled(window.scrollY > threshold);
    }
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [threshold]);

  return scrolled;
}
