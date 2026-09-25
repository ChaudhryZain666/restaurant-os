import { useMemo } from "react";
import { AdditiveBlending } from "three";
import type { Color } from "three";

interface SpotlightProps {
  color: Color;
}

const spotVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const spotFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5));
    float falloff = smoothstep(0.55, 0.0, d);
    float alpha = falloff * uOpacity;
    if (alpha < 0.005) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Phase 80 — replaces HomePage's CSS radial-gradient hero overlay with a plane that actually sits
 * in the 3D space, so the light falloff reads as coming from within the scene rather than painted
 * on top of it. Additive blending, no depth write — pure light contribution, one draw call.
 */
export function Spotlight({ color }: SpotlightProps) {
  // Phase 80 note: was 0.5 — dominated the grid entirely in review (a solid warm wash instead of
  // a light source within the scene). Toned down so the blueprint grid and the menu panels both
  // stay legible as their own distinct layers.
  const uniforms = useMemo(() => ({ uColor: { value: color }, uOpacity: { value: 0.3 } }), [color]);

  return (
    <mesh position={[1.6, 1.4, -3.5]}>
      <planeGeometry args={[7, 7]} />
      <shaderMaterial
        vertexShader={spotVertexShader}
        fragmentShader={spotFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
      />
    </mesh>
  );
}
