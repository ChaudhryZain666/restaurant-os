import type { Category } from "@restaurant/types";
import { IconImage, IconSearch, IconSliders } from "../icons";

export type AvailabilityFilter = "all" | "available" | "unavailable";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Phase 81 Stage 2 — the menu builder's left rail: search, availability filter (relocated from the
 * old inline bar above the category list, same logic), plus 2 new filters the brief asked for that
 * have real underlying data on a live MenuItem (has modifiers, no photo). "Items needing review"
 * from the brief's own filter list is deliberately NOT included here — that flag only ever exists
 * on an in-progress MenuImportJob's draft rows (see ImportReviewList.tsx), never on a published
 * MenuItem, so it would have nothing real to filter on here.
 */
export function CategoryNavRail({
  categories,
  itemCountByCategory,
  totalItemCount,
  search,
  onSearchChange,
  availabilityFilter,
  onAvailabilityFilterChange,
  hasModifiersOnly,
  onHasModifiersOnlyChange,
  noImageOnly,
  onNoImageOnlyChange,
  onJumpToCategory,
}: {
  categories: Category[];
  itemCountByCategory: Map<string, number>;
  totalItemCount: number;
  search: string;
  onSearchChange: (value: string) => void;
  availabilityFilter: AvailabilityFilter;
  onAvailabilityFilterChange: (value: AvailabilityFilter) => void;
  hasModifiersOnly: boolean;
  onHasModifiersOnlyChange: (value: boolean) => void;
  noImageOnly: boolean;
  onNoImageOnlyChange: (value: boolean) => void;
  onJumpToCategory: (categoryId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <label className="relative flex items-center">
        <IconSearch className="pointer-events-none absolute left-3 h-4 w-4 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search items"
          aria-label="Search menu items"
          className={`w-full py-1.5 pl-9 pr-3 ${inputClass}`}
        />
      </label>

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <IconSliders className="h-3.5 w-3.5" /> Filters
        </p>
        <div role="group" aria-label="Filter by availability" className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5">
          {(["all", "available", "unavailable"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onAvailabilityFilterChange(value)}
              aria-pressed={availabilityFilter === value}
              className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors duration-fast ${
                availabilityFilter === value ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-black/[0.04] hover:text-foreground"
              }`}
            >
              {value === "all" ? "All" : value === "available" ? "Available" : "Unavailable"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={hasModifiersOnly} onChange={(e) => onHasModifiersOnlyChange(e.target.checked)} />
          Has add-ons
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" checked={noImageOnly} onChange={(e) => onNoImageOnlyChange(e.target.checked)} />
          <IconImage className="h-3.5 w-3.5 text-muted" /> No photo
        </label>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Categories</p>
        <button
          type="button"
          onClick={() => onJumpToCategory("")}
          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm font-medium text-foreground transition-colors duration-fast hover:bg-black/[0.04]"
        >
          All items
          <span className="text-xs text-muted">{totalItemCount}</span>
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onJumpToCategory(category.id)}
            className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 transition-colors duration-fast hover:bg-black/[0.04] hover:text-foreground"
          >
            <span className="truncate">{category.name}</span>
            <span className="shrink-0 text-xs text-muted">{itemCountByCategory.get(category.id) ?? 0}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
