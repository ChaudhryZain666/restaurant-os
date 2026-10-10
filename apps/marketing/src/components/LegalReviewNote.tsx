import type { ReactNode } from "react";

/**
 * Phase 88 — an internal note that a passage still needs founder/legal review (not a fact the
 * page can state). Shown in local development only, so the gap stays visible while drafting; a
 * production build renders nothing here, and never publishes the "[FOUNDER/LEGAL REVIEW
 * REQUIRED]" marker. Open review items are tracked in docs/production-deployment-runbook.md.
 */
export function LegalReviewNote({ children }: { children: ReactNode }) {
  // A conditional expression (not an early return) so production builds compile the marker out.
  return import.meta.env.DEV ? (
    <>
      {" "}
      <strong>[FOUNDER/LEGAL REVIEW REQUIRED]</strong> — {children}
    </>
  ) : null;
}
