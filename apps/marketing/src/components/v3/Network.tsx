import { ADMIN_START_URL } from "../../lib/links";
import { Pinned } from "./Pinned";
import { ease, lerp, seg, useIsDesktop } from "./motion";

type Node = { id: string; label: string; sub?: string; x: number; y: number; level: 0 | 1 | 2 | 3 };

/** Positions in a 1000×600 field. Level 0 = the original restaurant, 1 = its extra locations,
 *  2 = the agency layer, 3 = the agency's other client restaurants. Client names are the same
 *  illustrative businesses the agency dashboard mock uses elsewhere on the site. */
const NODES: Node[] = [
  { id: "wk", label: "Wildwood Kitchen", sub: "Your restaurant", x: 500, y: 330, level: 0 },
  { id: "loc1", label: "Location 2", sub: "Own menu & hours", x: 360, y: 470, level: 1 },
  { id: "loc2", label: "Location 3", sub: "Own staff", x: 640, y: 470, level: 1 },
  { id: "agency", label: "Your agency", sub: "One login", x: 500, y: 90, level: 2 },
  { id: "c1", label: "Ember & Oak", sub: "2 locations", x: 180, y: 300, level: 3 },
  { id: "c2", label: "Riverside Deli", sub: "1 location", x: 820, y: 300, level: 3 },
  { id: "c3", label: "Casa Marisol", sub: "1 location", x: 820, y: 470, level: 3 },
];
/** Mobile recomposes into a taller 400×500 field rather than shrinking the wide one. */
const MOBILE_POS: Record<string, { x: number; y: number }> = {
  agency: { x: 200, y: 60 },
  c1: { x: 72, y: 175 },
  c2: { x: 328, y: 175 },
  c3: { x: 328, y: 315 },
  wk: { x: 200, y: 280 },
  loc1: { x: 105, y: 430 },
  loc2: { x: 295, y: 430 },
};
const FIELD = { desktop: { w: 1000, h: 600 }, mobile: { w: 400, h: 500 } };

const EDGES: [string, string, 1 | 2 | 3][] = [
  ["wk", "loc1", 1],
  ["wk", "loc2", 1],
  ["agency", "wk", 2],
  ["agency", "c1", 3],
  ["agency", "c2", 3],
  ["c2", "c3", 3],
];

const PHASES = [
  {
    title: "One restaurant.",
    copy: "Your storefront, your kitchen, your customers — running on one system.",
  },
  {
    title: "Then more locations.",
    copy: "Each keeps its own menu, hours and staff. You see the whole business in one place — no second system.",
  },
  {
    title: "Or many restaurants.",
    copy: "Agencies run every client from one login. Each client keeps its own brand, staff and owner access; you get one bill.",
  },
];

/**
 * SCENE 8 — THE NETWORK. Growth without starting over, in three beats the visitor scrolls
 * through: one restaurant → its own extra locations → the camera pulls back to an agency running
 * several client restaurants. Plain language throughout (no "tenants", no "entitlements") — written
 * for an agency owner, not an engineer.
 */
export function Network() {
  const desktop = useIsDesktop();

  return (
    <Pinned length={2.6} background="#0f0c0d" label="Multiple locations and agency management">
      {(p) => {
        const grow = [1, ease(seg(p, 0.2, 0.4)), ease(seg(p, 0.5, 0.66)), ease(seg(p, 0.6, 0.8))];
        const phase = p < 0.45 ? (p < 0.2 ? 0 : 1) : 2;
        const pull = ease(seg(p, 0.48, 0.72)); // camera pulls back for the agency view
        const zoom = lerp(desktop ? 1.25 : 1.08, 1, pull);
        const field = desktop ? FIELD.desktop : FIELD.mobile;
        const pos = (n: Node) => (desktop ? n : MOBILE_POS[n.id]);

        return (
          <div className="relative flex h-full w-full flex-col px-5 pt-24 sm:px-10 lg:flex-row lg:items-center lg:gap-12 lg:px-16 lg:pt-12">
            <div className="relative z-10 shrink-0 lg:w-[32%]">
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-[#c9838d]">
                The network
              </p>
              <div className="relative mt-4 min-h-[9.5rem] lg:min-h-[13rem]">
                {PHASES.map((ph, i) => (
                  <div
                    key={ph.title}
                    className="absolute inset-0"
                    style={{
                      opacity: i === phase ? 1 : 0,
                      transform: `translateY(${i === phase ? 0 : i < phase ? -16 : 16}px)`,
                      transition: "opacity 450ms ease, transform 450ms ease",
                    }}
                    aria-hidden={i !== phase}
                  >
                    <h2 className="font-heading text-[9vw] font-semibold leading-[1] tracking-tight text-[#f6f0e2] lg:text-[3.4vw]">
                      {ph.title}
                    </h2>
                    <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
                      {ph.copy}
                    </p>
                  </div>
                ))}
              </div>
              {desktop && (
                <a
                  href={ADMIN_START_URL}
                  className="mt-4 inline-flex h-11 items-center rounded-pill border border-white/30 px-5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  style={{ opacity: seg(p, 0.7, 0.85) }}
                >
                  Start an agency account →
                </a>
              )}
            </div>

            <div className="relative mt-6 w-full flex-1 lg:mt-0">
              <div
                className="relative mx-auto w-full max-w-[860px]"
                style={{
                  aspectRatio: `${field.w} / ${field.h}`,
                  transform: `scale(${zoom})`,
                  // the tall mobile field must also fit the frame's height on landscape tablets
                  maxWidth: desktop ? undefined : "min(100%, calc((100svh - 380px) * 0.8))",
                }}
              >
                <svg
                  viewBox={`0 0 ${field.w} ${field.h}`}
                  className="absolute inset-0 h-full w-full"
                  aria-hidden
                >
                  {EDGES.map(([a, b, lvl]) => {
                    const A = pos(NODES.find((n) => n.id === a)!);
                    const B = pos(NODES.find((n) => n.id === b)!);
                    return (
                      <line
                        key={`${a}-${b}`}
                        x1={A.x}
                        y1={A.y}
                        x2={B.x}
                        y2={B.y}
                        stroke={lvl === 2 ? "#c9838d" : "rgba(245,239,230,0.3)"}
                        strokeWidth={lvl === 2 ? 1.6 : 1.1}
                        pathLength={1}
                        strokeDasharray="1 1"
                        strokeDashoffset={1 - grow[lvl]}
                      />
                    );
                  })}
                </svg>
                <ul className="m-0 list-none p-0">
                  {NODES.map((n) => {
                    const g = grow[n.level];
                    const isAgency = n.level === 2;
                    const isRoot = n.level === 0;
                    return (
                      <li
                        key={n.id}
                        className="absolute flex flex-col items-center text-center"
                        style={{
                          left: `${(pos(n).x / field.w) * 100}%`,
                          top: `${(pos(n).y / field.h) * 100}%`,
                          opacity: g,
                          transform: `translate(-50%, -50%) scale(${lerp(0.6, 1, g)})`,
                        }}
                      >
                        <span
                          className="flex items-center justify-center rounded-full border"
                          style={{
                            width: isRoot ? 58 : isAgency ? 50 : 30,
                            height: isRoot ? 58 : isAgency ? 50 : 30,
                            borderColor: isAgency
                              ? "#e3aab2"
                              : isRoot
                                ? "#c9838d"
                                : "rgba(245,239,230,0.35)",
                            background: isRoot
                              ? "#611b28"
                              : isAgency
                                ? "rgba(97,27,40,0.35)"
                                : "#1d1719",
                            boxShadow: isRoot ? "0 0 40px 6px rgba(97,27,40,0.55)" : "none",
                          }}
                        >
                          {isRoot && (
                            <span aria-hidden className="font-heading text-lg text-[#f6f0e2]">
                              W
                            </span>
                          )}
                        </span>
                        <span className="mt-2 whitespace-nowrap font-heading text-[13px] text-[#f6f0e2] lg:text-base">
                          {n.label}
                        </span>
                        {n.sub && (
                          <span className="whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.18em] text-white/45 lg:text-[10px]">
                            {n.sub}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {!desktop && (
              <a
                href={ADMIN_START_URL}
                className="relative z-10 mb-10 inline-flex h-11 items-center self-start rounded-pill border border-white/30 px-5 text-sm font-medium text-white"
              >
                Start an agency account →
              </a>
            )}
          </div>
        );
      }}
    </Pinned>
  );
}
