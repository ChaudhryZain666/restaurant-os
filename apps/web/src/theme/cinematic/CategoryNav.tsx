import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Cinematic — a slim, dark, underline-driven strip (no pill backgrounds), sitting just under the
 *  header's sticky position so the two read as one continuous dark bar once scrolled. */
export function CinematicCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[76px] z-30 flex gap-7 overflow-x-auto border-b border-secondary-foreground/10 bg-secondary px-6 py-4 sm:px-14",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 whitespace-nowrap border-b-2 pb-1 text-xs font-medium uppercase tracking-[0.2em] transition-colors duration-fast ${
            activeCategoryId === category.id
              ? "border-accent text-secondary-foreground"
              : "border-transparent text-secondary-foreground/50 hover:text-secondary-foreground/80"
          }`}
        >
          {category.name}
        </button>
      ))}
    </nav>
  );
}
