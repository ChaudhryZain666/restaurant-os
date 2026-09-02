import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Modern — underlined text tabs, bold uppercase, no pill backgrounds. */
export function ModernCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[61px] z-30 flex gap-6 overflow-x-auto border-b-2 border-foreground bg-background px-4 py-3 sm:px-6",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 border-b-2 pb-1 text-xs font-bold uppercase tracking-widest transition-colors duration-fast ${
            activeCategoryId === category.id ? "border-primary text-foreground" : "border-transparent text-foreground/45 hover:text-foreground"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
