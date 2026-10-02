import { useId, useState } from "react";
import { Reveal } from "@restaurant/ui";

/**
 * One question/answer disclosure. The answer is always in the HTML — `hidden` until opened rather
 * than not rendered — so search engines and in-page find can reach it, and the button is wired to
 * it with aria-controls for assistive tech.
 */
export function FaqItem({ q, a, index }: { q: string; a: string; index: number }) {
  const [open, setOpen] = useState(false);
  const answerId = useId();
  return (
    <Reveal
      index={index % 5}
      className="overflow-hidden rounded-xl border border-border bg-surface"
    >
      <h3 className="m-0">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={answerId}
          className="flex w-full items-center justify-between gap-4 p-5 text-left font-sans text-base font-normal leading-normal tracking-normal"
        >
          <span className="font-medium text-foreground">{q}</span>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            className={`h-4 w-4 shrink-0 text-muted transition-transform duration-fast ${open ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </h3>
      <p id={answerId} hidden={!open} className="px-5 pb-5 text-sm text-muted">
        {a}
      </p>
    </Reveal>
  );
}
