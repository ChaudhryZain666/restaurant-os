import { useEffect, useState } from "react";

/** Tracks whether the page has scrolled past `threshold` — mirrors apps/web's own
 *  theme/useScrolled.ts (the storefront's identical need for a scroll-reactive sticky header). */
export function useScrolled(threshold = 10): boolean {
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
