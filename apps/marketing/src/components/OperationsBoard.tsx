import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { cn, useReducedMotion, useScrollReveal } from "@restaurant/ui";
import { AnimatedNumber } from "./AnimatedNumber";
import { MiniLineChart } from "./MiniLineChart";
import { OFFER_FEATURES } from "../lib/content";
import {
  IconArrowRight,
  IconCart,
  IconChart,
  IconClipboard,
  IconHeadset,
  IconMapPin,
  IconMenuBook,
  IconPalette,
  IconPhone,
  IconQr,
  IconStar,
  IconTag,
  IconTruck,
  IconUsers,
} from "./icons";

const FEATURE_ICONS = {
  "online-ordering": IconCart,
  "digital-menu": IconMenuBook,
  "order-management": IconClipboard,
  delivery: IconTruck,
  customers: IconUsers,
  promotions: IconTag,
  analytics: IconChart,
  loyalty: IconStar,
  "qr-ordering": IconQr,
  "multi-location": IconMapPin,
  branding: IconPalette,
  support: IconHeadset,
} as const;

/** "STATION 01" style operational index, not a decorative icon-in-a-circle. */
function stationNumber(i: number) {
  return String(i + 1).padStart(2, "0");
}

/**
 * A single tile on the board. Large tiles (the four primary operations) get more room for their
 * moment; small tiles are compact "stations." Every tile keeps the exact same functional contract
 * as the old FeatureCard: real title/description/status from OFFER_FEATURES, and the same
 * `/product#id` link — only the presentation changes.
 */
function Tile({
  id,
  index,
  size,
  children,
}: {
  id: (typeof OFFER_FEATURES)[number]["id"];
  index: number;
  size: "lg" | "sm";
  children: React.ReactNode;
}) {
  const feature = OFFER_FEATURES.find((f) => f.id === id)!;
  const Icon = FEATURE_ICONS[id];
  const { ref, visible } = useScrollReveal<HTMLAnchorElement>();

  return (
    <Link
      to={`/product#${id}`}
      id={id}
      ref={ref}
      className={cn(
        "group relative flex scroll-mt-24 flex-col justify-between overflow-hidden border border-white/10 bg-[#141210] p-5 transition-all duration-500",
        size === "lg" ? "min-h-[280px]" : "min-h-[180px]",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0"
      )}
      style={{ transitionDelay: visible ? `${Math.min(index, 8) * 70}ms` : "0ms" }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: "radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--color-primary) 10%, transparent), transparent 60%)" }}
        aria-hidden
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/30">STN.{stationNumber(index)}</span>
          <Icon className="h-3.5 w-3.5 text-primary/70" />
        </div>
        {feature.status === "roadmap" && (
          <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">Roadmap</span>
        )}
      </div>

      <div className="relative my-4 flex-1">{children}</div>

      <div className="relative">
        <h3 className={cn("font-heading text-white", size === "lg" ? "text-xl" : "text-base")}>{feature.title}</h3>
        <p className={cn("mt-1 text-white/50", size === "lg" ? "text-sm" : "text-xs")}>{feature.description}</p>
        <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          Learn more <IconArrowRight className="h-3 w-3" />
        </span>
      </div>
    </Link>
  );
}

/* ---------------------------------------------------------------------- */
/* Moments — one small operational demonstration per feature               */
/* ---------------------------------------------------------------------- */

function OnlineOrderingMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const lines = [
    { name: "Margherita Pizza", price: 12.5 },
    { name: "Loaded Fries", price: 7.0 },
  ];
  const total = lines.reduce((s, l) => s + l.price, 0);
  return (
    <div ref={ref} className="flex flex-col gap-2 font-mono text-sm">
      {lines.map((l, i) => (
        <div
          key={l.name}
          className="flex items-center justify-between text-white/70 transition-all duration-500"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateX(0)" : "translateX(-8px)",
            transitionDelay: `${i * 200}ms`,
          }}
        >
          <span>{l.name}</span>
          <span>${l.price.toFixed(2)}</span>
        </div>
      ))}
      <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-white">
        <span className="text-xs uppercase tracking-wide text-white/40">Total</span>
        <span className="text-lg font-semibold">
          <AnimatedNumber value={total} format={(n) => `$${n.toFixed(2)}`} />
        </span>
      </div>
      <span className="text-[10px] text-success">$0.00 commission</span>
    </div>
  );
}

function DigitalMenuMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const items = [
    { name: "Margherita Pizza", price: "$12.50" },
    { name: "Caesar Salad", price: "$8.50" },
    { name: "Tiramisu", price: "$6.00" },
  ];
  return (
    <div ref={ref} className="flex flex-col gap-1.5">
      {items.map((item, i) => (
        <div
          key={item.name}
          className="flex items-center justify-between rounded-sm border px-2.5 py-2 text-sm transition-colors duration-500"
          style={{ borderColor: visible && i === 0 ? "color-mix(in srgb, var(--color-primary) 60%, transparent)" : "rgba(255,255,255,0.08)" }}
        >
          <span className="text-white/80">{item.name}</span>
          <span className="font-mono text-xs text-white/45">{item.price}</span>
        </div>
      ))}
    </div>
  );
}

const ORDER_STATES = ["New", "Preparing", "Ready"] as const;
function OrderManagementMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(reducedMotion ? ORDER_STATES.length - 1 : 0);

  useEffect(() => {
    if (!visible || reducedMotion) return;
    const t1 = setTimeout(() => setStep(1), 700);
    const t2 = setTimeout(() => setStep(2), 1500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible, reducedMotion]);

  const tone = step === 0 ? "text-primary" : step === 1 ? "text-info" : "text-success";
  return (
    <div ref={ref} className="flex flex-col gap-3">
      <div className="flex items-center justify-between font-mono text-xs text-white/40">
        <span>#1047</span>
        <span>2 items · Pickup</span>
      </div>
      <div className="flex items-center gap-2">
        {ORDER_STATES.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span
              className={cn("h-1.5 flex-1 rounded-full transition-colors duration-500", i <= step ? "bg-current" : "bg-white/10")}
              style={{ color: i <= step ? "currentColor" : undefined }}
            />
          </div>
        ))}
      </div>
      <span className={cn("font-mono text-sm font-semibold uppercase tracking-wide transition-colors duration-500", tone)}>
        {ORDER_STATES[step]}
      </span>
    </div>
  );
}

function AnalyticsMoment() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wide text-white/40">Revenue this week</span>
        <span className="font-heading text-lg text-white">
          <AnimatedNumber value={8420} format={(n) => `$${Math.round(n).toLocaleString()}`} />
        </span>
      </div>
      <MiniLineChart points={[3, 5, 4, 7, 6, 9, 8]} height={44} strokeClassName="stroke-primary" />
    </div>
  );
}

function DeliveryMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <svg viewBox="0 0 160 24" className="w-full" aria-hidden>
        <line x1="6" y1="12" x2="154" y2="12" stroke="rgba(255,255,255,0.12)" strokeWidth="2" strokeDasharray="4 4" />
        <line
          x1="6"
          y1="12"
          x2="154"
          y2="12"
          stroke="var(--color-primary)"
          strokeWidth="2"
          strokeDasharray="148"
          strokeDashoffset={visible ? 0 : 148}
          style={{ transition: "stroke-dashoffset 1200ms cubic-bezier(0.16,1,0.3,1)" }}
        />
        <circle cx="6" cy="12" r="4" fill="var(--color-primary)" />
        <circle cx="154" cy="12" r="4" fill="white" fillOpacity="0.7" />
      </svg>
      <div className="flex items-center justify-between font-mono text-[10px] text-white/40">
        <span>Restaurant</span>
        <span>18 min ETA</span>
        <span>Customer</span>
      </div>
    </div>
  );
}

function CustomersMoment() {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-white/80">Jordan Lee</p>
        <p className="font-mono text-[10px] text-white/40">Returning customer</p>
      </div>
      <p className="font-heading text-lg text-white">
        <AnimatedNumber value={12} /> <span className="text-xs font-sans text-white/40">orders</span>
      </p>
    </div>
  );
}

function PromotionsMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-col gap-2">
      <div
        className="w-fit rounded-sm border border-success/30 bg-success/10 px-2.5 py-1 font-mono text-sm font-semibold text-success transition-all duration-500"
        style={{ opacity: visible ? 1 : 0, transform: visible ? "scale(1)" : "scale(0.9)" }}
      >
        WELCOME10
      </div>
      <span className="text-xs text-white/45">10% off, min. $15 — applied at checkout</span>
    </div>
  );
}

function LoyaltyMoment() {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-heading text-2xl text-white">
        <AnimatedNumber value={2140} /> <span className="text-xs font-sans text-white/40">pts</span>
      </p>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-[71%] rounded-full bg-primary" />
      </div>
    </div>
  );
}

function QrOrderingMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex items-center gap-4">
      <div className="grid h-14 w-14 shrink-0 grid-cols-4 grid-rows-4 gap-[2px] rounded-sm bg-white p-1.5">
        {Array.from({ length: 16 }).map((_, i) => (
          <span key={i} className="rounded-[1px]" style={{ background: [0, 3, 5, 9, 10, 12, 15].includes(i) ? "#0f0d0c" : "transparent" }} />
        ))}
      </div>
      <IconPhone
        className="h-6 w-6 text-white/60 transition-all duration-500"
        style={{ opacity: visible ? 1 : 0, transform: visible ? "translateX(0)" : "translateX(-6px)", transitionDelay: "400ms" }}
      />
    </div>
  );
}

function MultiLocationMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const offsets = [0, 1, 2];
  return (
    <div ref={ref} className="relative h-16">
      {offsets.map((o) => (
        <div
          key={o}
          className="absolute h-12 w-20 rounded-sm border border-white/15 bg-[#1b1712] transition-all duration-500"
          style={{
            left: visible ? `${o * 26}px` : 0,
            top: visible ? `${o * 4}px` : 0,
            opacity: visible ? 1 - o * 0.18 : o === 0 ? 1 : 0,
            transitionDelay: `${o * 140}ms`,
            zIndex: 3 - o,
          }}
        />
      ))}
    </div>
  );
}

function BrandingMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  const colors = ["#e08a3e", "#0f766e", "#7c3aed", "#be123c"];
  return (
    <div ref={ref} className="flex items-center gap-2">
      {colors.map((c, i) => (
        <span
          key={c}
          className="h-7 w-7 rounded-full border-2 transition-all duration-300"
          style={{ background: c, borderColor: visible && i === 0 ? "white" : "transparent", transitionDelay: `${i * 100}ms` }}
        />
      ))}
    </div>
  );
}

function SupportMoment() {
  const { ref, visible } = useScrollReveal<HTMLDivElement>();
  return (
    <div ref={ref} className="flex flex-col gap-1.5 text-xs">
      <p className="w-fit rounded-sm bg-white/[0.06] px-2 py-1.5 text-white/70">"One of my sides didn't arrive."</p>
      <p
        className="ml-4 w-fit rounded-sm bg-primary/15 px-2 py-1.5 text-primary transition-all duration-500"
        style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(4px)", transitionDelay: "500ms" }}
      >
        "Refunding now."
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------------- */

export function OperationsBoard() {
  return (
    <div>
      <div className="mb-10 max-w-2xl">
        <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Now operating</span>
        <h2 className="mt-3 font-heading text-3xl text-white sm:text-4xl">Everything a restaurant needs to sell online</h2>
        <p className="mt-3 text-white/55">Not a stripped-down ordering form — a full restaurant commerce toolkit, in one dashboard.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-1 lg:col-span-3">
          <Tile id="online-ordering" index={0} size="lg">
            <OnlineOrderingMoment />
          </Tile>
        </div>
        <div className="sm:col-span-1 lg:col-span-3">
          <Tile id="order-management" index={1} size="lg">
            <OrderManagementMoment />
          </Tile>
        </div>
        <div className="sm:col-span-1 lg:col-span-3">
          <Tile id="analytics" index={2} size="lg">
            <AnalyticsMoment />
          </Tile>
        </div>
        <div className="sm:col-span-1 lg:col-span-3">
          <Tile id="digital-menu" index={3} size="lg">
            <DigitalMenuMoment />
          </Tile>
        </div>

        <div className="lg:col-span-2">
          <Tile id="delivery" index={4} size="sm">
            <DeliveryMoment />
          </Tile>
        </div>
        <div className="lg:col-span-2">
          <Tile id="customers" index={5} size="sm">
            <CustomersMoment />
          </Tile>
        </div>
        <div className="lg:col-span-2">
          <Tile id="promotions" index={6} size="sm">
            <PromotionsMoment />
          </Tile>
        </div>
        <div className="lg:col-span-2">
          <Tile id="loyalty" index={7} size="sm">
            <LoyaltyMoment />
          </Tile>
        </div>
        <div className="lg:col-span-2">
          <Tile id="branding" index={8} size="sm">
            <BrandingMoment />
          </Tile>
        </div>
        <div className="lg:col-span-2">
          <Tile id="support" index={9} size="sm">
            <SupportMoment />
          </Tile>
        </div>
        <div className="lg:col-span-3">
          <Tile id="qr-ordering" index={10} size="sm">
            <QrOrderingMoment />
          </Tile>
        </div>
        <div className="lg:col-span-3">
          <Tile id="multi-location" index={11} size="sm">
            <MultiLocationMoment />
          </Tile>
        </div>
      </div>
    </div>
  );
}
