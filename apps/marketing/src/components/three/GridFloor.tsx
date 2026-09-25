import { useMemo } from "react";
import type { Color } from "three";
import { gridFragmentShader, gridVertexShader } from "./shaders/grid.js";

interface GridFloorProps {
  color: Color;
}

/**
 * Phase 80 — the existing CSS `.bg-grid-drift` blueprint motif, promoted into real depth: one
 * plane, one draw call, an unlit shader material with a distance fade so the grid recedes into
 * the scene rather than tiling flatly to the horizon. Direct continuity with the design already on
 * the page, not a new visual vocabulary.
 */
export function GridFloor({ color }: GridFloorProps) {
  const uniforms = useMemo(
    () => ({
      uColor: { value: color },
      uOpacity: { value: 0.5 },
      uCellSize: { value: 24 },
      uFadeDistance: { value: 14 },
    }),
    [color]
  );

  return (
    <mesh rotation={[-Math.PI / 2.4, 0, 0]} position={[0, -1.4, -2]}>
      <planeGeometry args={[20, 20, 1, 1]} />
      <shaderMaterial
        vertexShader={gridVertexShader}
        fragmentShader={gridFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}
