import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Urban — solid blocks, not underlines or pills: the active category is a filled tab, inactive
 *  ones are outlined. Sits directly under the header's own thick rule so the two read as one
 *  continuous graphic band once scrolled. */
export function UrbanCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[65px] z-30 flex gap-2 overflow-x-auto border-b-4 border-foreground bg-background px-4 py-3 sm:px-6",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 whitespace-nowrap border-2 px-4 py-2 font-heading text-xs font-black uppercase tracking-wide transition-colors duration-fast ${
            activeCategoryId === category.id
              ? "border-foreground bg-foreground text-background"
              : "border-transparent text-foreground/55 hover:border-foreground/25 hover:text-foreground"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
