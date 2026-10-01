import type { ReactNode } from "react";
import { Reveal } from "@restaurant/ui";

/**
 * The redesign's one heading system. Every chapter opens the same way — a numbered mono marker,
 * an editorial serif title, an optional intro — so twelve sections read as one story rather than
 * twelve unrelated components. Numbers are real sequence (the page is a narrative in order), not
 * decoration. `dark` picks the ink or parchment palette; parchment always uses the `-fixed` tokens
 * because the whole page sits inside `.theme-obsidian`, where theme-relative colors resolve dark.
 */

export const INK = "var(--gt-ink-fixed)";
export const PARCHMENT = "var(--gt-parchment-fixed)";

export function ChapterMark({ n, label, dark }: { n: string; label: string; dark: boolean }) {
  return (
    <div
      className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.24em]"
      style={{ color: dark ? "rgba(245,239,230,0.5)" : "rgba(43,33,22,0.55)" }}
    >
      <span style={{ color: dark ? "#c9838d" : "var(--gt-brand-fixed)" }}>{n}</span>
      <span
        aria-hidden
        className="h-px w-8"
        style={{ background: "currentColor", opacity: 0.45 }}
      />
      <span>{label}</span>
    </div>
  );
}

export function ChapterHeading({
  n,
  label,
  title,
  intro,
  dark,
  align = "left",
}: {
  n: string;
  label: string;
  title: ReactNode;
  intro?: ReactNode;
  dark: boolean;
  align?: "left" | "center";
}) {
  const centered = align === "center";
  return (
    <Reveal
      className={
        centered
          ? "mx-auto flex max-w-3xl flex-col items-center text-center"
          : "flex max-w-3xl flex-col"
      }
    >
      <ChapterMark n={n} label={label} dark={dark} />
      <h2
        className="mt-5 font-heading text-4xl font-semibold leading-[1.04] tracking-tight sm:text-5xl lg:text-[3.6rem]"
        style={{ color: dark ? "#f6f0e2" : "var(--gt-text-fixed)", textWrap: "balance" }}
      >
        {title}
      </h2>
      {intro && (
        <p
          className="mt-5 max-w-2xl text-lg leading-relaxed"
          style={{ color: dark ? "rgba(245,239,230,0.62)" : "var(--gt-text-muted-fixed)" }}
        >
          {intro}
        </p>
      )}
    </Reveal>
  );
}

/** A full-bleed chapter band. Hard ink/parchment cuts between chapters are deliberate — an
 *  editorial page turn — rather than the gradient blends the previous homepage used everywhere. */
export function Chapter({
  id,
  dark,
  children,
  className = "",
}: {
  id?: string;
  dark: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative scroll-mt-20 px-5 py-24 sm:px-8 sm:py-32 lg:px-14 ${className}`}
      style={{ background: dark ? INK : PARCHMENT }}
    >
      <div className="relative mx-auto max-w-6xl">{children}</div>
    </section>
  );
}
