import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";

export interface HeroDriverState {
  /** 0-1, same "how far through the viewport has the hero travelled" semantics as
   *  apps/marketing/src/lib/useScrollProgress.ts — measured against the same section element, so
   *  the CSS hero card and this camera stay in visual agreement without sharing React state. */
  progress: number;
  pointerX: number;
  pointerY: number;
}

interface CameraRigProps {
  sectionRef: RefObject<HTMLElement | null>;
  driver: RefObject<HeroDriverState>;
}

const EPSILON = 0.0005;

/**
 * Phase 80 — owns the hero's scroll/pointer tracking AND the camera damping in one place,
 * specifically because both need `invalidate()` (only available via `useThree()`, i.e. only
 * inside `<Canvas>`) to make `frameloop="demand"` actually work: a ref update from a raw `window`
 * listener never schedules a new frame on its own under "demand" mode. Keeping the listeners here,
 * right next to the `invalidate()` call, is what makes "render nothing while nothing is moving"
 * real rather than aspirational.
 */
export function CameraRig({ sectionRef, driver }: CameraRigProps) {
  const { camera, invalidate } = useThree();
  const current = useRef(new Vector3(0, 0, 6));
  const target = useRef(new Vector3(0, 0, 6));

  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const raw = (vh - rect.top) / (vh + rect.height);
      driver.current.progress = Math.min(1, Math.max(0, raw));
      invalidate();
    }
    function onScroll() {
      if (frame) return;
      frame = requestAnimationFrame(measure);
    }
    function onPointerMove(event: PointerEvent) {
      driver.current.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      driver.current.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      invalidate();
    }

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, [sectionRef, driver, invalidate]);

  useFrame((_, delta) => {
    const { progress, pointerX, pointerY } = driver.current;
    target.current.set(pointerX * 0.35, 0.4 - progress * 0.5 + pointerY * -0.15, 6 - progress * 1.2);

    const before = current.current.distanceToSquared(target.current);
    current.current.lerp(target.current, Math.min(1, delta * 3));
    camera.position.copy(current.current);
    camera.lookAt(0, 0, -1.5);

    // Only keep requesting frames while the camera is still visibly converging — once it settles,
    // this stops calling invalidate() and the canvas renders zero further frames until the next
    // scroll/pointer event. This is the literal implementation of "high movement -> calm."
    if (before > EPSILON || current.current.distanceToSquared(target.current) > EPSILON) {
      invalidate();
    }
  });

  return null;
}
