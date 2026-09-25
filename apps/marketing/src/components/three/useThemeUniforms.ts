import { useMemo } from "react";
import type { RefObject } from "react";
import { Color } from "three";

function readToken(el: Element, name: string, fallback: string): string {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

export interface ThemeUniformColors {
  grid: Color;
  panel: Color;
  spotlight: Color;
}

/**
 * Phase 80 — reads the real `.theme-obsidian` GT tokens (not the "-fixed" light-palette set —
 * this scene only ever renders inside the dark hero) from the hero's own DOM node once at mount,
 * so the 3D scene's colors stay driven by index.css's single source of truth instead of
 * duplicating hex literals here. Must read from an element actually inside `.theme-obsidian` (not
 * `document.documentElement`, which is `:root` itself) — that's where the dark overrides apply via
 * CSS cascade.
 */
export function useThemeUniforms(containerRef: RefObject<HTMLElement | null>): ThemeUniformColors {
  return useMemo(() => {
    const el = containerRef.current ?? document.documentElement;
    return {
      grid: new Color(readToken(el, "--gt-border", "#2e2620")),
      panel: new Color(readToken(el, "--gt-surface", "#24171b")),
      spotlight: new Color(readToken(el, "--gt-brand", "#c9838d")),
    };
    // Deliberately empty deps — colors are read once at mount, matching every other place in this
    // scene that treats the theme as static for the lifetime of the canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
