import type { CategoryNavProps } from "../types";

/** Minimal — a single row of plain text tabs, left-aligned to match the page's own left edge
 *  (never centered, unlike Editorial's centered tab row), separated by generous whitespace instead
 *  of pill backgrounds or dot dividers. The active tab gets a thin underline; nothing else changes
 *  — no bold weight shift, no color other than foreground/muted. Sticks just below the header so
 *  the two hairline rules read as one continuous, quiet strip once the visitor scrolls. */
export function MinimalCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className="sticky top-[61px] z-30 flex gap-8 overflow-x-auto border-b border-border bg-background py-4 sm:top-[69px]"
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 whitespace-nowrap border-b pb-1 text-[13px] tracking-[0.02em] transition-colors duration-fast ${
            activeCategoryId === category.id ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
