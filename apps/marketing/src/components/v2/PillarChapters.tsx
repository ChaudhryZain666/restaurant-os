import type { ReactNode } from "react";
import { Reveal } from "@restaurant/ui";
import { Chapter, ChapterHeading } from "./Chapter";
import {
  AnalyticsMock,
  CheckoutMock,
  DeliveryMock,
  LoyaltyMock,
  MenuMock,
  MockFrame,
  OrdersMock,
} from "../FeatureMocks";

/**
 * One layout for Sell / Run / Grow: copy and a short list of real capabilities on one side, a
 * composed pair of product screens on the other — a primary screen with a smaller one set
 * forward, overlapping its corner, like two windows on a desk rather than two cards in a grid.
 * Alternates sides so three consecutive chapters don't stamp the same shape. The screens are the
 * same clearly-illustrative mocks the Product page uses (built from real admin/storefront
 * layouts and copy), rendered dark — product UI on parchment, which reads as a device.
 */
function Pillar({
  id,
  n,
  label,
  title,
  intro,
  points,
  primary,
  primaryLabel,
  secondary,
  secondaryLabel,
  flip = false,
}: {
  id: string;
  n: string;
  label: string;
  title: string;
  intro: string;
  points: string[];
  primary: ReactNode;
  primaryLabel: string;
  secondary: ReactNode;
  secondaryLabel: string;
  flip?: boolean;
}) {
  return (
    <Chapter id={id} dark={false} className="py-20 sm:py-28">
      <div
        className={`grid items-center gap-16 lg:grid-cols-2 lg:gap-20 ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}
      >
        <div>
          <ChapterHeading n={n} label={label} dark={false} title={title} intro={intro} />
          <ul className="mt-10 flex list-none flex-col p-0">
            {points.map((point, i) => (
              <Reveal
                as="li"
                key={point}
                index={i}
                className="flex items-baseline gap-4 border-t py-3.5 text-[15px]"
                style={{ borderColor: "var(--gt-border-fixed)", color: "var(--gt-text-fixed)" }}
              >
                <span
                  aria-hidden
                  className="font-mono text-[10px] tracking-wider"
                  style={{ color: "var(--gt-brand-fixed)" }}
                >
                  ●
                </span>
                {point}
              </Reveal>
            ))}
          </ul>
        </div>

        <Reveal variant="fade" className="relative sm:pb-16 sm:pr-10">
          <figure className="m-0">
            <MockFrame>{primary}</MockFrame>
            <figcaption
              className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em]"
              style={{ color: "var(--gt-text-muted-fixed)" }}
            >
              {primaryLabel}
            </figcaption>
          </figure>
          <figure className="relative mt-4 ml-auto mr-0 w-[82%] shadow-[0_40px_80px_-30px_rgba(23,20,22,0.55)] sm:absolute sm:-right-2 sm:bottom-0 sm:mt-0 sm:w-[62%] sm:max-w-[300px]">
            <MockFrame>{secondary}</MockFrame>
            <figcaption className="sr-only">{secondaryLabel}</figcaption>
          </figure>
        </Reveal>
      </div>
    </Chapter>
  );
}

export function SellChapter() {
  return (
    <Pillar
      id="sell"
      n="04"
      label="Sell"
      title="Sell directly, under your own name."
      intro="A storefront that looks like your restaurant, on your own domain — with a menu customers can actually order from on their phones."
      points={[
        "Branded ordering storefront, on your own domain",
        "Menu with photos, modifiers and live availability",
        "QR ordering at the table — no app to download",
        "Promo codes and customer accounts",
      ]}
      primary={<MenuMock />}
      primaryLabel="Menu management"
      secondary={<CheckoutMock />}
      secondaryLabel="Customer checkout with a promo code applied"
    />
  );
}

export function RunChapter() {
  return (
    <Pillar
      id="run"
      n="05"
      label="Run"
      title="Run the service, not the software."
      intro="Online, table and counter orders land in one queue. The kitchen works from it, the counter rings up on the built-in POS, and delivery runs alongside pickup."
      points={[
        "One live queue for online, QR and counter orders",
        "Kitchen view with time-in-queue for every ticket",
        "Built-in POS for counter and table sales",
        "Delivery areas, fees and minimums alongside pickup",
      ]}
      primary={<OrdersMock />}
      primaryLabel="Live order queue"
      secondary={<DeliveryMock />}
      secondaryLabel="Pickup and delivery settings"
      flip
    />
  );
}

export function GrowChapter() {
  return (
    <Pillar
      id="grow"
      n="06"
      label="Grow"
      title="Grow what's already working."
      intro="Know who your regulars are, reward them for coming back, and see which dishes and days are actually carrying the week."
      points={[
        "Loyalty points that accrue automatically",
        "Revenue, order volume and top sellers",
        "Every customer's order history",
        "More locations, each with its own menu and hours",
      ]}
      primary={<AnalyticsMock />}
      primaryLabel="Owner analytics"
      secondary={<LoyaltyMock />}
      secondaryLabel="A customer's loyalty balance"
    />
  );
}
