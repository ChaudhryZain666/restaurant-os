/**
 * Responsive WebP renditions of the demo restaurant's photography (generated from the original
 * JPEGs; the originals are no longer shipped). One place for the srcsets, so the hero, the
 * closing scene and index.html's first-load preload all request the same candidate.
 */
export const COVER = {
  src: "/v3/demo-restaurant-cover-1280.webp",
  srcSet:
    "/v3/demo-restaurant-cover-768.webp 768w, /v3/demo-restaurant-cover-1280.webp 1280w, /v3/demo-restaurant-cover-1800.webp 1800w",
  /** For small renditions (avatars, pane headers) where the 768w file is already plenty. */
  small: "/v3/demo-restaurant-cover-768.webp",
};

/** 4:3 photo cropped into a 4:5 frame — the needed width follows the frame's height (~1.67× its width). */
export const MARGHERITA = {
  src: "/v3/margherita-pizza-1000.webp",
  srcSet:
    "/v3/margherita-pizza-640.webp 640w, /v3/margherita-pizza-1000.webp 1000w, /v3/margherita-pizza-1400.webp 1400w",
  sizes: "(min-width: 1280px) 940px, (min-width: 1024px) 72vw, 160vw",
};
