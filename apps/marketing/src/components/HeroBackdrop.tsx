import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useWebglEligible } from "../lib/useWebglEligible.js";

const HeroFieldScene = lazy(() => import("./three/HeroFieldScene.js"));

/**
 * Phase 80 — silent-fallback boundary: if the lazy 3D chunk fails to load or the scene throws (a
 * shader compile error, a genuine WebGL context-creation failure, a chunk 404 after a deploy),
 * this renders nothing rather than the app's global "Something went wrong" card (`@restaurant/ui`'s
 * `ErrorBoundary`, which is the right tool for a real page-breaking error, not for "one optional
 * decorative layer didn't load"). The CSS grid/gradient layer underneath is still there and simply
 * stays visible — the hero degrades to exactly what it already was before this phase.
 */
class SilentBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error) {
    console.error("[HeroBackdrop] 3D scene failed, falling back to the CSS hero:", error);
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

function scheduleIdle(callback: () => void, timeout: number): number {
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, { timeout });
  }
  return window.setTimeout(callback, 300);
}

function cancelIdle(id: number): void {
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(id);
  } else {
    window.clearTimeout(id);
  }
}

interface HeroBackdropProps {
  /** The hero `<section>` itself — the 3D camera measures scroll progress against this, the same
   *  element `HeroScene.tsx`'s own `useScrollProgress` measures, so the CSS card and the WebGL
   *  camera stay in visual agreement without sharing React state. */
  sectionRef: RefObject<HTMLElement | null>;
}

/**
 * Phase 80 — the hero's background environment layer. Always renders the existing CSS blueprint
 * grid + radial spotlight (moved here unchanged from HomePage.tsx) as the permanent base; on
 * eligible desktop devices only, lazily loads the R3F scene at idle (after first paint, never
 * competing with it) and cross-fades it in over the CSS layer. Mobile, reduced-motion, low-power,
 * and no-WebGL devices simply keep the CSS layer forever — nothing else changes for them, and
 * there is no separate "simplified 3D scene" to build or maintain for that path.
 */
export function HeroBackdrop({ sectionRef }: HeroBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const eligible = useWebglEligible();
  const [loadScene, setLoadScene] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    if (!eligible) {
      setLoadScene(false);
      setSceneReady(false);
      return;
    }
    const idleId = scheduleIdle(() => setLoadScene(true), 2000);
    return () => cancelIdle(idleId);
  }, [eligible]);

  const showScene = eligible && loadScene;

  return (
    <div ref={containerRef} className="pointer-events-none absolute inset-0" aria-hidden>
      {/* Base CSS layer — the site's existing blueprint-grid + radial-spotlight hero treatment,
          unchanged in content from HomePage.tsx, just relocated here. This is the permanent
          fallback, not a placeholder: it stays mounted and simply fades down once the 3D scene
          reports itself ready, and fades right back if the scene ever unmounts/fails. */}
      <div
        className="bg-grid-drift absolute inset-0 transition-opacity duration-[600ms]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
          opacity: sceneReady ? 0 : 0.1,
        }}
      />
      <div
        className="absolute inset-0 transition-opacity duration-[600ms]"
        style={{
          background: "radial-gradient(ellipse 60% 50% at 30% 8%, rgba(255,255,255,0.08), transparent 65%)",
          opacity: sceneReady ? 0 : 1,
        }}
      />

      {showScene && (
        <SilentBoundary>
          <Suspense fallback={null}>
            <HeroFieldScene sectionRef={sectionRef} containerRef={containerRef} onReady={() => setSceneReady(true)} />
          </Suspense>
        </SilentBoundary>
      )}
    </div>
  );
}
