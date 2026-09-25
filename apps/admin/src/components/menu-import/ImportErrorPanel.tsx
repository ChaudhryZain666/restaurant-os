import { Link } from "react-router-dom";
import type { MenuImportJobDetail } from "@restaurant/types";
import { Button } from "@restaurant/ui";
import { IconAlertTriangle } from "../icons";

const POSSIBLE_REASONS: Record<MenuImportJobDetail["sourceType"], string[]> = {
  pdf: ["The file is password protected", "The document is too large or has too many pages", "The menu text couldn't be detected"],
  image: ["The photo is too blurry or dark to read", "The photo is too large"],
  images: ["One of the photos is too blurry or dark to read", "One of the photos is too large"],
  url: ["The page requires a login", "The page couldn't be reached or timed out", "The address points somewhere we can't fetch from"],
};

/**
 * Phase 81 Stage 2 — never a bare "Something went wrong." Renders the job's own real, specific
 * error message (already honest and distinct per failure mode from Stage 1's SafeFetchError/
 * MenuExtractionError), a plausible-reasons list matched to the source type, and real recovery
 * paths rather than a dead end.
 */
export function ImportErrorPanel({ job }: { job: MenuImportJobDetail }) {
  const reasons = POSSIBLE_REASONS[job.sourceType];
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-border bg-surface p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <IconAlertTriangle className="h-6 w-6" />
      </span>
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">We couldn't read this {job.sourceType === "url" ? "page" : job.sourceType === "pdf" ? "PDF" : "photo"}</h1>
        {job.error?.message && <p className="mt-1 text-sm text-muted">{job.error.message}</p>}
      </div>
      <div className="w-full max-w-sm text-left">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Possible reasons</p>
        <ul className="mt-1.5 flex flex-col gap-1 text-sm text-muted">
          {reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted" />
              {reason}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Link to="/menu/import">
          <Button size="sm">Try another file</Button>
        </Link>
        {job.sourceType !== "images" && (
          <Link to="/menu/import">
            <Button size="sm" variant="outline">
              Upload photos instead
            </Button>
          </Link>
        )}
        <Link to="/menu">
          <Button size="sm" variant="ghost">
            Build manually
          </Button>
        </Link>
      </div>
    </div>
  );
}
