import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Classic — a sticky horizontal row of pill buttons, scroll-spy highlighted. */
export function ClassicCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[65px] z-30 flex gap-2 overflow-x-auto border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 rounded-pill px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
            activeCategoryId === category.id ? "bg-primary text-primary-foreground" : "bg-black/[0.04] text-foreground hover:bg-black/[0.08]"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
