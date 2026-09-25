import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraRig, type HeroDriverState } from "./CameraRig.js";
import { GridFloor } from "./GridFloor.js";
import { MenuPanels } from "./MenuPanels.js";
import { Spotlight } from "./Spotlight.js";
import { useThemeUniforms } from "./useThemeUniforms.js";

export interface HeroFieldSceneProps {
  sectionRef: RefObject<HTMLElement | null>;
  containerRef: RefObject<HTMLElement | null>;
  /** Fires once after mount — HeroBackdrop uses it to know when it's safe to cross-fade the CSS
   *  grid/gradient layer out in favor of this scene. */
  onReady?: () => void;
}

/**
 * Phase 80 — the R3F hero backdrop's actual scene graph. This is the lazy chunk entry point
 * (dynamically imported by HeroBackdrop.tsx, never referenced from a synchronously-loaded module)
 * — this file and everything it imports is the ~180-220KB gzip chunk that only capable,
 * motion-friendly desktop browsers ever download, well after first paint. Four draw calls total
 * (grid + spotlight + up to 6 panel meshes, unlit shader materials only — no lights, no shadow
 * maps), colors read live from the real GT design tokens, never hardcoded.
 */
export default function HeroFieldScene({ sectionRef, containerRef, onReady }: HeroFieldSceneProps) {
  const driver = useRef<HeroDriverState>({ progress: 0, pointerX: 0, pointerY: 0 });
  const colors = useThemeUniforms(containerRef);

  useEffect(() => {
    onReady?.();
  }, [onReady]);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      flat
      gl={{
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
        // Phase 80 note: this used to also set failIfMajorPerformanceCaveat: true, meant as a
        // guarantee against forcing WebGL onto weak/software-rendered devices. In practice it was
        // too aggressive — Chrome flags a real, non-trivial share of ordinary discrete/integrated
        // GPUs as a "performance caveat" for driver-version/blocklist reasons that have nothing to
        // do with whether this specific, extremely cheap scene (4 draw calls, no textures, no
        // lights) would actually run fine — confirmed directly: it silently killed context
        // creation on a real test machine that has no trouble with this scene once the flag is
        // removed. The other eligibility gates (useWebglEligible.ts: viewport width, hover/pointer
        // capability, core count, device memory, reduced motion/data) already do the real
        // filtering; this flag was blocking more than it was protecting.
      }}
      camera={{ position: [0, 0, 6], fov: 42 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      aria-hidden
      role="presentation"
      performance={{ min: 0.5 }}
    >
      <CameraRig sectionRef={sectionRef} driver={driver} />
      <GridFloor color={colors.grid} />
      <MenuPanels color={colors.panel} driver={driver} />
      <Spotlight color={colors.spotlight} />
    </Canvas>
  );
}
