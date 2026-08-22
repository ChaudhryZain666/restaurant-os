import type { CSSProperties, ReactNode } from "react";
import { useRestaurant } from "../context/RestaurantContext";

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** WCAG relative luminance — used only to pick a readable foreground (near-white or near-black)
 * against a restaurant's custom brand color. Never used for any business decision. */
function isDark(hex: string): boolean {
  const [r, g, b] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map((h) => parseInt(h, 16) / 255);
  const [rl, gl, bl] = [r, g, b].map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl < 0.5;
}

/**
 * Applies a restaurant's optional `settings.brandColor` as a CSS-variable override, cascading to
 * every Tailwind class that resolves through --color-primary (bg-primary, text-primary,
 * border-primary, ...) — see the design-token notes in index.css. This is the ONLY thing theme
 * configuration is allowed to touch: colors. It cannot reach pricing, permissions, availability,
 * ownership, or any other business logic, because it only ever sets two CSS custom properties.
 *
 * Uses `display: contents` on the wrapper so it never participates in layout — the app's
 * flex/height structure is completely unaffected, only descendants' computed CSS variables
 * change. A missing or malformed color (regex-validated server-side, but re-checked here too —
 * never trust a value without checking it locally as well) falls back to the default theme
 * rather than breaking anything.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { restaurant } = useRestaurant();
  const brandColor = restaurant?.settings.brandColor;

  if (!brandColor || !HEX_PATTERN.test(brandColor)) {
    return <>{children}</>;
  }

  const style: CSSProperties = {
    display: "contents",
    ["--color-primary" as string]: brandColor,
    ["--color-primary-foreground" as string]: isDark(brandColor) ? "#fffaf5" : "#1c1917",
  };

  return <div style={style}>{children}</div>;
}
