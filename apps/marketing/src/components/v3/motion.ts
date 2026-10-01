import { useEffect, useState } from "react";

/** 0→1 sub-range of p: 0 before `a`, 1 after `b`, linear between. */
export function seg(p: number, a: number, b: number): number {
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Smoothstep easing for scrubbed values — scroll is linear, motion shouldn't be. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/** True at Tailwind's lg breakpoint and up — scenes recompose (not shrink) below it. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true
  );
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return desktop;
}
