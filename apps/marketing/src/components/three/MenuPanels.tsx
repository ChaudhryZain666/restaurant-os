import { useMemo, useRef } from "react";
import type { RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { Color, Group } from "three";
import type { HeroDriverState } from "./CameraRig.js";

interface MenuPanelsProps {
  color: Color;
  driver: RefObject<HeroDriverState>;
}

// Phase 80 — hand-placed rather than formula-generated: an even angular spread put half the
// panels behind the headline's own screen region (the DOM text sits in front regardless, but
// crowding decorative depth directly under readable copy still looked busy in review). Biased
// toward the right/negative-space side of the frame instead, at clearly separated depths so each
// panel actually reads as its own object rather than a cluster.
const PANEL_LAYOUT = [
  { x: 2.6, y: 0.9, z: -1.2, rotY: 0.18 },
  { x: 4.1, y: -0.4, z: -2.4, rotY: -0.12 },
  { x: 3.0, y: -1.6, z: -3.4, rotY: 0.08 },
  { x: 5.2, y: 1.3, z: -3.0, rotY: -0.2 },
  { x: 1.6, y: -2.2, z: -4.2, rotY: 0.14 },
  { x: 4.6, y: -1.9, z: -5.0, rotY: -0.06 },
];

const panelVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const panelFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;

  float roundedBoxSdf(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) - radius;
  }

  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = roundedBoxSdf(p, vec2(0.86), 0.22);
    float fill = smoothstep(0.02, -0.02, d);
    float border = smoothstep(0.05, -0.05, abs(d + 0.02) - 0.02);
    float alpha = fill * uOpacity * 0.14 + border * uOpacity * 0.55;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

/**
 * Phase 80 — "dimensional menu surfaces" per the brief: untextured rounded panels floating at
 * varied depths, never literal menu content (no text, no photos — that stays the DOM hero's job,
 * same division of labor as everywhere else on this page). Six individual meshes rather than a
 * real InstancedMesh — this few objects don't need instancing's complexity, and each gets its own
 * gentle, independent-reading drift from pointer position.
 */
export function MenuPanels({ color, driver }: MenuPanelsProps) {
  const group = useRef<Group>(null);
  const uniforms = useMemo(() => ({ uColor: { value: color }, uOpacity: { value: 1 } }), [color]);

  useFrame((_, delta) => {
    if (!group.current) return;
    const { pointerX, pointerY } = driver.current;
    const ease = Math.min(1, delta * 1.5);
    group.current.rotation.y += (pointerX * 0.08 - group.current.rotation.y) * ease;
    group.current.rotation.x += (pointerY * -0.04 - group.current.rotation.x) * ease;
  });

  return (
    <group ref={group}>
      {PANEL_LAYOUT.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]} rotation={[0, p.rotY, 0]}>
          <planeGeometry args={[1.1, 1.5]} />
          <shaderMaterial
            vertexShader={panelVertexShader}
            fragmentShader={panelFragmentShader}
            uniforms={uniforms}
            transparent
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
