import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import {
  MockFrame,
  AnalyticsMock,
  BrandingMock,
  CheckoutMock,
  CustomersMock,
  DeliveryMock,
  LoyaltyMock,
  ModifierMock,
  OrdersMock,
  PromotionsMock,
  SupportMock,
} from "../components/FeatureMocks";
import {
  IconArrowRight,
  IconCart,
  IconChart,
  IconClipboard,
  IconHeadset,
  IconMapPin,
  IconMenuBook,
  IconPalette,
  IconQr,
  IconStar,
  IconTag,
  IconTruck,
  IconUsers,
} from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

interface Feature {
  id: string;
  title: string;
  tagline: string;
  description: string;
  points: string[];
  status: "available" | "roadmap";
  icon: (p: { className?: string }) => ReactNode;
  /** A realistic UI mockup shown instead of a plain icon card — omitted only for the two
   *  still-roadmap features that have nothing built yet to honestly depict. */
  visual?: ComponentType;
}

const FEATURES: Feature[] = [
  {
    id: "online-ordering",
    title: "Online Ordering",
    tagline: "Your own direct ordering channel",
    description: "Customers order straight from your restaurant's ordering page — no third-party app, no per-order commission cut.",
    points: ["Pickup and delivery in one checkout", "Cart, order type and totals calculated live", "Order confirmation and status tracking included"],
    status: "available",
    icon: IconCart,
    visual: CheckoutMock,
  },
  {
    id: "digital-menu",
    title: "Digital Menu",
    tagline: "Built for how people actually order",
    description: "A mobile-first menu with categories, photos, descriptions, pricing and modifiers — not a PDF pretending to be a menu.",
    points: ["Photo support with polished placeholders", "Required and optional modifier groups", "Live availability, so sold-out items don't get ordered"],
    status: "available",
    icon: IconMenuBook,
    visual: ModifierMock,
  },
  {
    id: "order-management",
    title: "Order Management",
    tagline: "A queue your staff can actually run on",
    description: "Every order moves through a clear status lifecycle your team controls, from acceptance to completion.",
    points: ["Accept, prepare, ready, complete — one tap each", "Cancel and refund-status handling", "Order history stays searchable after the fact"],
    status: "available",
    icon: IconClipboard,
    visual: OrdersMock,
  },
  {
    id: "delivery",
    title: "Delivery",
    tagline: "Pickup and delivery, one dashboard",
    description: "Turn delivery on or off, set a delivery fee and minimum order amount, and manage it alongside pickup.",
    points: ["Per-restaurant delivery fee and minimum order", "Delivery toggled independently of pickup", "Zone/route planning is on our roadmap"],
    status: "available",
    icon: IconTruck,
    visual: DeliveryMock,
  },
  {
    id: "customers",
    title: "Customer Management",
    tagline: "Know who's actually ordering",
    description: "Every order is tied to a real customer account, so you can see order history instead of guessing.",
    points: ["Customer order history, per restaurant", "Foundation for segmentation and campaigns", "Full customer profiles are on our roadmap"],
    status: "available",
    icon: IconUsers,
    visual: CustomersMock,
  },
  {
    id: "promotions",
    title: "Promotions",
    tagline: "Bring customers back with an offer",
    description: "Create discount codes that make ordering direct more attractive than ordering elsewhere — validated and priced on the server, every time.",
    points: ["Percentage or fixed-amount discount codes", "Minimum order amount and usage limits", "Optional expiry date per code"],
    status: "available",
    icon: IconTag,
    visual: PromotionsMock,
  },
  {
    id: "analytics",
    title: "Analytics",
    tagline: "See the business, not just the orders",
    description: "Revenue, order volume, average order value and top-selling items, updated as orders come in.",
    points: ["Today and this-week performance at a glance", "Top-selling items ranked automatically", "Completed vs. cancelled order tracking"],
    status: "available",
    icon: IconChart,
    visual: AnalyticsMock,
  },
  {
    id: "loyalty",
    title: "Loyalty",
    tagline: "Reward the customers who keep coming back",
    description: "A points balance and history that gives repeat customers a reason to order direct instead of elsewhere.",
    points: ["Points balance and tier shown to customers", "Full transaction history", "Configurable earn/redeem rules on our roadmap"],
    status: "available",
    icon: IconStar,
    visual: LoyaltyMock,
  },
  {
    id: "qr-ordering",
    title: "QR Ordering",
    tagline: "Order from the table, on their own phone",
    description: "A QR code at the table links straight to your ordering page — no app download required.",
    points: ["Uses the same ordering page as online orders", "No dedicated hardware required", "Table-specific QR codes are on our roadmap"],
    status: "roadmap",
    icon: IconQr,
  },
  {
    id: "branding",
    title: "Restaurant Branding",
    tagline: "It looks like your restaurant, not a template",
    description: "Set your brand color and it repaints the entire ordering experience — buttons, links, highlights, all of it.",
    points: ["Logo, cover image and description supported", "Brand color applied platform-wide instantly", "Not a website builder — a focused ordering page"],
    status: "available",
    icon: IconPalette,
    visual: BrandingMock,
  },
  {
    id: "multi-location",
    title: "Multi-location",
    tagline: "One account, every location",
    description: "The platform's tenant architecture already supports it — a full multi-location dashboard is on our roadmap.",
    points: ["Each location keeps its own menu and orders", "Central account across locations", "Location-switcher UI is on our roadmap"],
    status: "roadmap",
    icon: IconMapPin,
  },
  {
    id: "support",
    title: "Customer Support",
    tagline: "A help center customers actually use",
    description: "A searchable knowledge base plus a ticketing system, built into the same ordering experience.",
    points: ["Searchable help articles by category", "Ticket creation, replies and resolution tracking", "Internal notes for your support team"],
    status: "available",
    icon: IconHeadset,
    visual: SupportMock,
  },
];

export function ProductPage() {
  usePageMeta({
    title: "Product — Tablecloth",
    description: "Everything a restaurant needs to sell direct: digital menu, ordering, delivery, loyalty, promotions and analytics in one platform.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Product"
          title="Everything included, laid out plainly"
          description="What's live today, and what's next — no feature marked available unless it actually works."
        />
      </Section>

      {FEATURES.map((feature, i) => (
        <Section key={feature.id} id={feature.id} tone={i % 2 === 0 ? "surface" : "default"}>
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <Reveal className={i % 2 === 1 ? "lg:order-2" : ""}>
              <div className="flex flex-col items-start gap-4">
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="h-6 w-6" />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-heading text-2xl font-semibold text-foreground">{feature.title}</h2>
                  <Badge tone={feature.status === "available" ? "success" : "warning"}>
                    {feature.status === "available" ? "Available now" : "On our roadmap"}
                  </Badge>
                </div>
                <p className="text-base font-medium text-primary">{feature.tagline}</p>
                <p className="text-muted">{feature.description}</p>
                <ul className="flex flex-col gap-2">
                  {feature.points.map((point) => (
                    <li key={point} className="flex items-start gap-2 text-sm text-foreground/80">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
            <Reveal index={1} className={i % 2 === 1 ? "lg:order-1" : ""}>
              {feature.visual ? (
                <div className="aspect-[4/3]">
                  <MockFrame>
                    <feature.visual />
                  </MockFrame>
                </div>
              ) : (
                <Card className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-primary/10 to-accent/10">
                  <feature.icon className="h-20 w-20 text-primary/40" />
                </Card>
              )}
            </Reveal>
          </div>
        </Section>
      ))}

      <Section tone="dark">
        <Reveal className="flex flex-col items-center gap-5 text-center">
          <h2 className="font-heading text-3xl font-semibold text-secondary-foreground">See it running, not just described</h2>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/demo">
              <Button size="lg" variant="secondary">
                Try the live demo
              </Button>
            </Link>
            <Link to="/start-trial">
              <Button size="lg" variant="outline" className="border-white/30 text-secondary-foreground hover:bg-white/10">
                Start Free Trial <IconArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </Reveal>
      </Section>
    </>
  );
}
