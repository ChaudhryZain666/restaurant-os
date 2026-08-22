import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Tracks the user's OS-level reduced-motion preference, including live changes. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (typeof window !== "undefined" ? window.matchMedia(QUERY).matches : false));

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
