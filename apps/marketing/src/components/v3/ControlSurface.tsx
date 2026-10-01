import { useMemo } from "react";
import { DashboardMock } from "../FeatureMocks";
import { Pinned } from "./Pinned";
import { ease, lerp, seg, useIsDesktop } from "./motion";
import { LoyaltyPane, MenuPane, OrdersPane, PosPane, Surface } from "./Surfaces";

const SATELLITES = [
  {
    key: "orders",
    label: "Kitchen · Queue",
    note: "Order #1047 — already in the kitchen",
    x: -64,
    y: -28,
    z: 120,
    w: 270,
  },
  {
    key: "pos",
    label: "Counter · POS",
    note: "Table 4 — paid at the counter",
    x: 64,
    y: -34,
    z: 60,
    w: 250,
  },
  {
    key: "loyalty",
    label: "Customer · Loyalty",
    note: "Jordan's points — added automatically",
    x: -60,
    y: 34,
    z: 40,
    w: 240,
  },
  {
    key: "menu",
    label: "Menu · Live",
    note: "Salmon 86'd — off the storefront instantly",
    x: 62,
    y: 30,
    z: 100,
    w: 270,
  },
] as const;

/**
 * SCENE 5 — THE SYSTEM. The product as an object: the owner dashboard begins laid flat like a
 * tabletop and rises to face the visitor as they scroll, while four other parts of the same system
 * drift in around it at different depths — each with a note tying it back to the same order.
 * "Everything, on one surface" is shown, not claimed.
 */
export function ControlSurface() {
  const desktop = useIsDesktop();
  const panes = useMemo(
    () => ({
      dashboard: <DashboardMock />,
      orders: <OrdersPane />,
      pos: <PosPane />,
      loyalty: <LoyaltyPane />,
      menu: <MenuPane />,
    }),
    []
  );

  return (
    <Pinned length={2.6} background="#1a1315" label="Everything on one surface">
      {(p) => {
        const rise = ease(seg(p, 0.05, 0.5));
        const orbit = ease(seg(p, 0.42, 0.8));
        const notes = seg(p, 0.7, 0.85);

        return (
          <div className="relative flex h-full w-full flex-col items-center px-5 pt-24 sm:px-10 lg:pt-20">
            <div className="relative z-20 text-center">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
                The system
              </p>
              <h2 className="mt-3 font-heading text-[9vw] font-semibold leading-[0.98] tracking-tight text-[#f6f0e2] lg:text-[4.2vw]">
                Everything, on <em>one surface.</em>
              </h2>
            </div>

            <div
              className="relative mt-6 flex w-full flex-1 items-start justify-center lg:mt-10"
              style={{ perspective: "1600px" }}
            >
              {/* the dashboard: tabletop → upright */}
              <div
                className="relative w-full max-w-[860px]"
                style={{
                  transformOrigin: "50% 100%",
                  transform: `rotateX(${lerp(64, 0, rise)}deg) translateY(${lerp(60, 0, rise)}px) scale(${lerp(0.9, desktop ? 0.82 : 1, orbit)})`,
                }}
              >
                <Surface label="Owner · Dashboard">{panes.dashboard}</Surface>
              </div>

              {desktop &&
                SATELLITES.map((s) => {
                  const pane = panes[s.key];
                  return (
                    <div
                      key={s.key}
                      className="absolute left-1/2 top-[38%]"
                      style={{
                        width: s.w,
                        opacity: orbit,
                        // x spreads across the viewport width so the outer panes never leave the frame
                        transform: `translate(-50%, -50%) translate3d(${((lerp(0.4, 1, orbit) * s.x) / 64) * 34}vw, ${lerp(s.y * 0.4, s.y, orbit) * 7}px, ${s.z}px) rotateY(${s.x > 0 ? -8 : 8}deg)`,
                      }}
                    >
                      <Surface label={s.label}>{pane}</Surface>
                      <p
                        className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-white/55"
                        style={{ opacity: notes, textAlign: s.x > 0 ? "right" : "left" }}
                      >
                        {s.note}
                      </p>
                    </div>
                  );
                })}
            </div>

            {!desktop && (
              <ul
                className="relative z-20 m-0 mb-8 grid w-full list-none grid-cols-2 gap-2 p-0"
                style={{ opacity: orbit }}
              >
                {SATELLITES.map((s) => (
                  <li key={s.key} className="rounded-lg border border-white/10 px-3 py-2">
                    <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-[#c9838d]">
                      {s.label}
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-white/70">
                      {s.note}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      }}
    </Pinned>
  );
}
