import { useEffect, useState } from "react";
import { useReducedMotion, logoMarkAsset } from "@restaurant/ui";

// The Hero's iframe is `loading="lazy"` and the R3F chunk loads at idle — both deliberately
// deferred past `window.load`, so that event alone under-reports real readiness (confirmed: the
// veil was vanishing well before those settled, popping in visibly after it was gone). A guaranteed
// minimum display time covers that gap without coupling this loader to Hero internals; MAX_WAIT_MS
// is only the hard ceiling for a slow/failed resource, not the expected case.
const MIN_DISPLAY_MS = 2400;
const MAX_WAIT_MS = 6000;
const FADE_MS = 550;
const BAR_SNAP_MS = 320;

/**
 * A branded loading veil for the homepage — hides first-paint layout shift/pop-in (web
 * fonts, the Hero's lazy R3F chunk if eligible, the live iframe's own network fetch) behind the
 * same mark + glow treatment `CinematicHero` uses, so it reads as the film's own countdown leader
 * rather than a generic spinner. A progress bar grows toward ~82% over `MIN_DISPLAY_MS` (a real,
 * standard "perceived progress" affordance, not a literal byte count — there's no reliable way to
 * measure that across a lazy iframe/chunk/fonts at once) and only completes to 100% once the page
 * is actually ready, so it never lies by sitting at 100% while something is still loading. Purely a
 * visual overlay — the real page renders underneath the whole time, so this never blocks hydration,
 * SEO content, or a11y; a `role="status"` announcement covers screen readers, removed the moment
 * it's done rather than left as a stale live region.
 */
export function CinematicLoader() {
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [barPct, setBarPct] = useState(4);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    const mountedAt = Date.now();
    const markReady = () => {
      if (cancelled) return;
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      window.setTimeout(() => {
        if (!cancelled) setReady(true);
      }, remaining);
    };

    const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
    const windowReady =
      document.readyState === "complete"
        ? Promise.resolve()
        : new Promise<void>((resolve) => window.addEventListener("load", () => resolve(), { once: true }));

    Promise.all([fontsReady, windowReady]).then(markReady);
    const timeout = window.setTimeout(markReady, MAX_WAIT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    // Kick the bar toward 82% right after mount — the CSS transition (below) does the actual
    // easing, this just moves the target once so the browser has something to animate toward.
    const t = window.setTimeout(() => setBarPct(82), 60);
    return () => window.clearTimeout(t);
  }, [reducedMotion]);

  useEffect(() => {
    if (!ready) return;
    setBarPct(100);
    const t = window.setTimeout(() => setHidden(true), BAR_SNAP_MS + FADE_MS);
    return () => window.clearTimeout(t);
  }, [ready]);

  if (hidden) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{
        background: "var(--gt-ink-fixed)",
        opacity: ready ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease ${ready ? `${BAR_SNAP_MS}ms` : "0ms"}`,
        pointerEvents: ready ? "none" : "auto",
      }}
    >
      <span className="sr-only">Loading GarnishTable…</span>
      <div className="flex flex-col items-center gap-7">
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          <div
            aria-hidden
            className={reducedMotion ? "absolute rounded-full" : "gt-glow-pulse absolute rounded-full"}
            style={{
              inset: 0,
              background: "radial-gradient(circle, var(--gt-glow) 0%, rgba(97,27,40,0.35) 45%, transparent 75%)",
              filter: "blur(14px)",
            }}
          />
          <img src={logoMarkAsset} alt="" style={{ width: 72, height: 72, objectFit: "contain", filter: "brightness(0) invert(1)" }} />
        </div>

        <div aria-hidden className="flex flex-col items-center gap-3">
          <div className="h-px overflow-hidden rounded-full" style={{ width: 180, background: "rgba(245,239,230,0.14)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${barPct}%`,
                background: "linear-gradient(90deg, var(--gt-glow), #c9838d)",
                transition: reducedMotion
                  ? "none"
                  : `width ${ready ? BAR_SNAP_MS : MIN_DISPLAY_MS * 0.92}ms ${ready ? "ease-out" : "cubic-bezier(0.16,1,0.3,1)"}`,
              }}
            />
          </div>
          <span
            className="font-mono text-[10px] uppercase tracking-[0.28em]"
            style={{ color: "rgba(245,239,230,0.4)" }}
          >
            {ready ? "Ready" : "Loading the experience"}
          </span>
        </div>
      </div>
    </div>
  );
}
