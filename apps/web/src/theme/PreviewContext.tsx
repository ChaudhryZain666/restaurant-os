import { createContext, useContext, type ReactNode } from "react";

/** Whether the storefront is rendering inside a constrained preview frame (the admin Theme Studio
 *  playground) rather than as the real, full-viewport storefront. Themes that size elements against
 *  the real browser viewport (e.g. Cinematic's `vh`-based hero) need this to size themselves
 *  against the preview frame's own bounds instead — a `vh` unit on a descendant always resolves
 *  against the actual browser viewport, never an ancestor's `max-height`, so the theme itself has to
 *  know it's in a bounded frame and choose a different size. Defaults to `false` (the real
 *  storefront); only PlaygroundPanel provides `true`. */
const PreviewContext = createContext(false);

export function PreviewModeProvider({ value, children }: { value: boolean; children: ReactNode }) {
  return <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>;
}

export function usePreviewMode(): boolean {
  return useContext(PreviewContext);
}
