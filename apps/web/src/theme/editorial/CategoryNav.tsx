import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Editorial — a centered row of thin, widely-tracked text tabs with a full underline on the
 *  active item; no pill backgrounds, no bold weight shift. */
export function EditorialCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[57px] z-30 flex justify-center gap-6 overflow-x-auto bg-background/95 px-4 py-3 backdrop-blur sm:px-6",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
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
