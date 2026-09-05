import { useEffect, useRef, useState } from "react";
import { cn } from "@restaurant/ui";
import type { CategoryNavProps } from "../types";
import { usePreviewMode } from "../PreviewContext";

/** Cinematic — a slim, dark, underline-driven strip (no pill backgrounds), sitting just under the
 *  header's sticky position so the two read as one continuous dark bar once scrolled. The active
 *  underline is one shared element that slides/resizes to the active tab (measured via refs, not a
 *  per-button border) rather than an instant color swap — a small, real motion cue that the active
 *  category actually moved, not just changed color. */
export function CinematicCategoryNav({ categories, activeCategoryId, onSelect }: CategoryNavProps) {
  const preview = usePreviewMode();
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const activeButton = nav.querySelector<HTMLButtonElement>(`[data-category-id="${activeCategoryId}"]`);
    if (activeButton) setIndicator({ left: activeButton.offsetLeft, width: activeButton.offsetWidth });
  }, [activeCategoryId, categories]);

  if (categories.length <= 1) return null;
  return (
    <nav
      ref={navRef}
      aria-label="Menu categories"
      className={cn(
        // `sticky` alone already establishes a positioned containing block for the absolutely-
        // positioned active-tab indicator below — a redundant `relative` here previously CONFLICTED
        // with `sticky` (both set the `position` CSS property; Tailwind's cascade let `relative` win),
        // which silently broke the intended "pins below the header on scroll" behavior and, combined
        // with `top-[76px]` then applying as a `position:relative` offset instead of a sticky one,
        // visually pushed this nav down while leaving its natural flow slot empty — the real cause of
        // a visible gap between the hero and this nav. Confirmed via computed-style inspection.
        //
        // `-mt-10` cancels MenuPage.tsx's shared `gap-10` flex spacing (between Hero/Alert/
        // CategoryNav/sections — every theme's Hero sits in that same flow) so this nav sits flush
        // against the hero, matching Hero.tsx's own established technique of cancelling ancestor
        // spacing via a negative margin rather than changing the shared cross-theme layout. Assumes
        // the availability Alert banner (shown only when the restaurant is paused/closed) isn't
        // rendered between them — an already-rare, lower-stakes path not chased further here.
        "sticky top-[76px] z-30 -mt-10 flex gap-7 overflow-x-auto border-b border-secondary-foreground/10 bg-secondary px-6 py-4 sm:px-14",
        preview ? "-mx-4 sm:-mx-6" : "full-bleed"
      )}
    >
      {categories.map((category) => (
        <button
          key={category.id}
          data-category-id={category.id}
          onClick={() => onSelect(category.id)}
          className={`shrink-0 whitespace-nowrap pb-1 text-xs font-medium uppercase tracking-[0.2em] transition-colors duration-fast ${
            activeCategoryId === category.id ? "text-secondary-foreground" : "text-secondary-foreground/50 hover:text-secondary-foreground/80"
          }`}
        >
          {category.name}
        </button>
      ))}
      {indicator && (
        <span
          className="pointer-events-none absolute bottom-0 h-0.5 bg-accent transition-[left,width] duration-normal ease-premium"
          style={{ left: indicator.left, width: indicator.width }}
          aria-hidden
        />
      )}
    </nav>
  );
}
