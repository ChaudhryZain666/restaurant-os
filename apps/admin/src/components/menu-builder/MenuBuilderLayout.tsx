import { useState, type ReactNode } from "react";
import { IconMenuBook, IconX } from "../icons";

/**
 * Phase 81 Stage 2 — the 3-pane menu builder shell. Desktop (`lg:`): a persistent left rail, the
 * center canvas, and `rightPanel` (the item editor) rendered as a direct flex sibling — it
 * self-positions via its own responsive classes (see ItemEditorDrawer.tsx), so this shell doesn't
 * need to know whether it's open. Below `lg:`: the left rail collapses into a slide-in drawer
 * (mirrors Layout.tsx's own established sidebar pattern — same breakpoint, same backdrop
 * convention); the right panel keeps its existing full-screen overlay behavior untouched.
 */
export function MenuBuilderLayout({
  leftRail,
  rightPanel,
  children,
}: {
  leftRail: ReactNode;
  rightPanel: ReactNode;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex w-full flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
      <button
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="flex w-fit items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-foreground lg:hidden"
      >
        <IconMenuBook className="h-4 w-4" />
        Menu sections
      </button>

      <div className="hidden lg:sticky lg:top-4 lg:block lg:w-64 lg:shrink-0">{leftRail}</div>

      {mobileNavOpen && (
        <>
          <div aria-hidden onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <div role="dialog" aria-modal="true" aria-label="Menu sections" className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-elevated lg:hidden">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close"
              className="self-end rounded-full p-1.5 text-muted transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground"
            >
              <IconX className="h-4 w-4" />
            </button>
            <div onClick={() => setMobileNavOpen(false)}>{leftRail}</div>
          </div>
        </>
      )}

      <div className="min-w-0 flex-1">{children}</div>

      {rightPanel}
    </div>
  );
}
