import { useEffect, useState } from "react";
import { useReducedMotion } from "@restaurant/ui";
import { STOREFRONT_URL } from "../lib/links";
import { DashboardMock, MenuMock, OrdersMock } from "./FeatureMocks";

/**
 * "The control room": one large active screen plus three smaller preview screens you switch
 * between, like a monitor wall — not heading -> tab pills -> single card. All four screens stay
 * mounted the whole time (only their position/size changes on click), specifically so the real
 * live iframe never remounts/reloads when you switch away from and back to it, and never has to
 * fight the other screens for stacking order (a real, confirmed browser quirk: iframes composite
 * above siblings unpredictably regardless of CSS z-index — sidestepped here by never overlapping
 * screens at all, only resizing/repositioning them).
 *
 * The Dashboard/Menu/Orders screens are the same clearly-illustrative mocks as before (nothing
 * safe to embed live for owner-only data on a public page). The "Live Storefront" screen is the
 * real, running demo restaurant in a real iframe — not a mockup, screenshot, or fake browser.
 */

type TabId = "dashboard" | "menu" | "orders" | "storefront";
const TABS: { id: TabId; label: string; caption: string }[] = [
  { id: "dashboard", label: "Owner Dashboard", caption: "Revenue, orders and status at a glance" },
  { id: "menu", label: "Menu Management", caption: "Items, prices and availability" },
  { id: "orders", label: "Orders", caption: "New, preparing and ready" },
  { id: "storefront", label: "Live Storefront", caption: "The real, running demo restaurant" },
];

/** Percentage-based layout for the "big" slot vs. the preview slots — computed per render from
 *  which tab is active, not hardcoded per tab, so any tab can become the big screen. A deliberately
 *  different arrangement below the sm breakpoint (main screen on top, full-width; 3 previews in a
 *  row underneath) rather than the desktop monitor-wall's 28%-wide side column, which measured out
 *  to an unusably narrow, squished preview on a real phone screen. */
function layoutFor(tabIndex: number, activeIndex: number, previewSlot: number, mobile: boolean) {
  if (tabIndex === activeIndex) {
    return mobile ? { left: "0%", top: "0%", width: "100%", height: "60%" } : { left: "0%", top: "0%", width: "70%", height: "100%" };
  }
  return mobile
    ? { left: `${previewSlot * 34}%`, top: "64%", width: "32%", height: "36%" }
    : { left: "72%", top: `${previewSlot * 34.5}%`, width: "28%", height: "32%" };
}

/** True below Tailwind's sm breakpoint (640px) — matches the breakpoint the rest of this component
 *  already uses via sm: classes, so the layout math and the CSS agree on where the line is. */
function useIsMobile() {
  const [mobile, setMobile] = useState(() => (typeof window !== "undefined" ? window.innerWidth < 640 : false));
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => setMobile(e.matches);
    handler(mql);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return mobile;
}

export function ProductShowcase() {
  const [active, setActive] = useState<TabId>("dashboard");
  const reducedMotion = useReducedMotion();
  const mobile = useIsMobile();
  const activeIndex = TABS.findIndex((t) => t.id === active);

  let previewSlot = 0;

  return (
    <div>
      <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-lg">
          <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-info">The control room</span>
          <h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">This is what your restaurant could look like</h2>
          <p className="mt-3 text-white/55">
            A real owner dashboard, real menu management, and the actual live customer ordering experience.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/40">
          <span className="h-1.5 w-1.5 rounded-full bg-info" style={{ boxShadow: "0 0 8px var(--color-info)" }} />
          On air — {TABS[activeIndex].label}
        </div>
      </div>

      <div className="relative h-[560px] sm:h-[520px] lg:h-[560px]">
        {TABS.map((tab, i) => {
          const isActive = tab.id === active;
          const slot = isActive ? -1 : previewSlot++;
          const rect = layoutFor(i, activeIndex, slot, mobile);
          return (
            <div
              key={tab.id}
              className="absolute overflow-hidden rounded-sm border bg-[#0c0b09]"
              style={{
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                borderColor: isActive ? "color-mix(in srgb, var(--color-info) 45%, transparent)" : "rgba(255,255,255,0.08)",
                boxShadow: isActive ? "0 40px 80px -30px rgba(0,0,0,0.7), 0 0 0 1px color-mix(in srgb, var(--color-info) 20%, transparent)" : "none",
                transition: reducedMotion ? "none" : "left 550ms cubic-bezier(0.16,1,0.3,1), top 550ms cubic-bezier(0.16,1,0.3,1), width 550ms cubic-bezier(0.16,1,0.3,1), height 550ms cubic-bezier(0.16,1,0.3,1), border-color 300ms ease",
              }}
            >
              <div className="flex items-center justify-between gap-1 border-b border-white/10 bg-[#100e0b] px-2 py-1.5 sm:px-3 sm:py-2">
                <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: isActive ? "var(--color-info)" : "rgba(255,255,255,0.25)" }}
                  />
                  <span className="truncate font-mono text-[9px] uppercase tracking-[0.1em] text-white/45 sm:text-[10px]">{tab.label}</span>
                </div>
                {tab.id === "storefront" && (
                  <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-success">Live</span>
                )}
              </div>

              <div className="relative h-[calc(100%-33px)] bg-white">
                {tab.id === "storefront" ? (
                  <iframe src={STOREFRONT_URL} title="Live demo restaurant storefront" className="h-full w-full border-0" loading="lazy" />
                ) : tab.id === "dashboard" ? (
                  <DashboardMock />
                ) : tab.id === "menu" ? (
                  <MenuMock />
                ) : (
                  <OrdersMock />
                )}
              </div>

              {!isActive && (
                <button
                  onClick={() => setActive(tab.id)}
                  aria-label={`Switch to ${tab.label}`}
                  className="absolute inset-0 flex items-end bg-transparent p-1.5 opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 sm:p-2"
                  style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.55), transparent 60%)" }}
                >
                  <span className="hidden font-mono text-[10px] uppercase tracking-wide text-white sm:inline">Switch view →</span>
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-center text-xs text-white/40">
        {active === "storefront"
          ? "This is the real, live demo restaurant — not a mockup. If it doesn't load, the storefront app may not be running locally."
          : "Clearly-illustrative product mockups — click a preview to switch the main screen."}
      </p>
    </div>
  );
}
