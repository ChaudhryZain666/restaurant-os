import type { CategoryNavProps } from "../types";

/** Editorial — a centered row of thin, widely-tracked text tabs with a full underline on the
 *  active item; no pill backgrounds, no bold weight shift. */
export function EditorialCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className="sticky top-[57px] z-30 -mx-4 flex justify-center gap-6 overflow-x-auto bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 border-b pb-1 text-xs uppercase tracking-[0.16em] transition-colors duration-fast ${
            activeCategoryId === category.id ? "border-foreground text-foreground" : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
