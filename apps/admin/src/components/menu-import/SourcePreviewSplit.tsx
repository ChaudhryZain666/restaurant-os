import type { MenuImportJobDetail } from "@restaurant/types";
import { IconFileText, IconImage } from "../icons";

/**
 * Phase 81 Stage 2 — groups the extracted rows by which source page/photo they came from, so a
 * reviewer can tell "these 4 items came from page 2" while correcting extraction mistakes.
 *
 * Deliberately does NOT render the original image/PDF bytes: doing that securely would need a new
 * authenticated file-streaming endpoint (source files aren't public URLs — see
 * MenuImportJob.sourceFiles' storageKey, deliberately never exposed as a direct link) plus
 * browser-side blob-URL handling, which is a real, disproportionate addition to make under this
 * stage's own "no apps/api changes" boundary. A real, disclosed limitation — the same discipline
 * already applied to not attempting in-browser PDF rendering — not a silent shortcut.
 */
export function SourcePreviewSplit({ job }: { job: MenuImportJobDetail }) {
  const pages = new Map<number, typeof job.draftRows>();
  for (const row of job.draftRows) {
    const key = row.sourcePageIndex ?? 0;
    const list = pages.get(key) ?? [];
    list.push(row);
    pages.set(key, list);
  }
  const sortedPages = [...pages.entries()].sort(([a], [b]) => a - b);
  const isPdf = job.sourceType === "pdf";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {isPdf ? <IconFileText className="h-4 w-4" /> : <IconImage className="h-4 w-4" />}
        </span>
        <div>
          <p className="font-heading text-sm font-semibold text-foreground">Original source</p>
          <p className="text-xs text-muted">
            {job.sourceFiles.length} {isPdf ? "page" : "photo"}
            {job.sourceFiles.length === 1 ? "" : "s"} uploaded
          </p>
        </div>
      </div>
      <p className="text-xs text-muted">Rows below are grouped by which {isPdf ? "page" : "photo"} they were read from.</p>
      <div className="flex flex-col gap-2">
        {sortedPages.map(([pageIndex, rows]) => (
          <div key={pageIndex} className="rounded-lg border border-border bg-background p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              {isPdf ? "Page" : "Photo"} {pageIndex || "—"}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5 text-sm text-foreground">
              {rows.map((row) => (
                <li key={row.rowNumber} className="truncate">
                  {row.itemName || "(no name)"}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
