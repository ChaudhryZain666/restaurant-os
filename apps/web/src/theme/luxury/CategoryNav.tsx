import type { CategoryNavProps } from "../types";

/** Luxury — a slim text-only strip, one hairline above and below; no pill backgrounds, no fills.
 *  The active category is marked by a thin underline, matching the header's own affordance. */
export function LuxuryCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className="sticky top-[61px] z-30 -mx-4 flex gap-8 overflow-x-auto border-b border-border bg-background px-5 py-3.5 sm:top-[73px] sm:-mx-6 sm:px-8"
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 whitespace-nowrap border-b pb-1 text-[13px] font-medium tracking-[0.02em] transition-colors duration-fast ${
            activeCategoryId === category.id ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
