import { Button } from "./Button.js";

export interface PaginationProps {
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPageChange: (page: number) => void;
  /** Shown next to the Prev/Next controls, e.g. "42 total". Omit for just "Page X of Y". */
  totalLabel?: string;
  className?: string;
}

/**
 * Purely presentational Prev/Next pager shared by every paginated list page (Phase 12) — data
 * fetching stays local to each page's existing `useEffect` + `apiClient.request` pattern, this
 * only renders the controls and reports the page the caller should fetch next. No page-number
 * jump-list: Prev/Next is enough for the list sizes these admin/platform surfaces deal with, and
 * keeps this component trivial to reuse without a router/URL-state dependency.
 */
export function Pagination({ page, totalPages, hasNextPage, hasPreviousPage, onPageChange, totalLabel, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ""}`}>
      <p className="text-sm text-muted">
        Page {page} of {totalPages}
        {totalLabel ? ` · ${totalLabel}` : ""}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage}
        >
          Previous
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={!hasNextPage}>
          Next
        </Button>
      </div>
    </div>
  );
}
