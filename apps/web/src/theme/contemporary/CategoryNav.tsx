import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Contemporary — a numbered, horizontal-scrolling strip, never a wrapping pill row: each category
 *  carries its own index number stacked above its name, and the active one is set apart with a solid
 *  foreground block rather than a soft pill or a simple underline. */
export function ContemporaryCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  if (categories.length <= 1) return null;
  return (
    <nav
      aria-label="Menu categories"
      className={cn(
        "sticky top-[73px] z-30 flex gap-px overflow-x-auto border-b-2 border-foreground bg-background sm:top-[106px]",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category, i) => {
        const active = activeCategoryId === category.id;
        return (
          <button
            key={category.id}
            onClick={() => onSelect(category.id)}
            className={`flex shrink-0 flex-col items-start gap-1 whitespace-nowrap px-5 py-3.5 text-left transition-colors duration-fast sm:px-7 ${
              active ? "bg-foreground text-background" : "text-foreground/70 hover:bg-border/40"
            }`}
          >
            <span className={`text-[10px] font-bold ${active ? "text-background/60" : "text-muted"}`}>{String(i + 1).padStart(2, "0")}</span>
            <span className="text-xs font-bold uppercase tracking-[0.14em]">{category.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
