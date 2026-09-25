// Phase 80 — inline GLSL (no plugin, no .glsl.d.ts shim needed) for the hero backdrop's blueprint
// grid, promoting the existing CSS .bg-grid-drift motif into real depth. Unlit, no lighting
// uniforms, one draw call.

export const gridVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying float vDist;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vDist = length(worldPos.xz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const gridFragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uCellSize;
  uniform float uFadeDistance;
  varying vec2 vUv;
  varying float vDist;

  float gridLine(vec2 uv, float cell) {
    vec2 grid = abs(fract(uv * cell - 0.5) - 0.5) / fwidth(uv * cell);
    return 1.0 - min(min(grid.x, grid.y), 1.0);
  }

  void main() {
    float line = gridLine(vUv, uCellSize);
    float fade = clamp(1.0 - vDist / uFadeDistance, 0.0, 1.0);
    float alpha = line * fade * uOpacity;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(uColor, alpha);
  }
`;
