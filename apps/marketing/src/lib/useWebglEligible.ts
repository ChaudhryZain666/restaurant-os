import { useEffect, useState } from "react";
import { useReducedMotion } from "@restaurant/ui";

/**
 * Phase 80 — gates the R3F hero backdrop to capable, motion-friendly desktop only. Reduced motion
 * is checked first and short-circuits everything else, same pattern as every other motion hook in
 * this app. The remaining checks are deliberately conservative (per the brief: "do not simply
 * force desktop WebGL onto every mobile device") — this only ever opts a device INTO the 3D
 * backdrop; the premium CSS-only HeroScene is the default for everyone until proven otherwise.
 * Reactive to viewport/media changes (not just computed once on mount) so resizing a desktop
 * window across the breakpoint mounts/unmounts the scene cleanly.
 */
export function useWebglEligible(): boolean {
  const reducedMotion = useReducedMotion();
  const [eligible, setEligible] = useState(false);

  useEffect(() => {
    if (reducedMotion || typeof window === "undefined") {
      setEligible(false);
      return;
    }

    const viewportQuery = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const dataQuery = window.matchMedia("(prefers-reduced-data: reduce)");
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const capableHardware = cores >= 4 && memory >= 4;

    function evaluate() {
      setEligible(capableHardware && viewportQuery.matches && !dataQuery.matches);
    }

    evaluate();
    viewportQuery.addEventListener("change", evaluate);
    dataQuery.addEventListener("change", evaluate);
    return () => {
      viewportQuery.removeEventListener("change", evaluate);
      dataQuery.removeEventListener("change", evaluate);
    };
  }, [reducedMotion]);

  return eligible;
}
