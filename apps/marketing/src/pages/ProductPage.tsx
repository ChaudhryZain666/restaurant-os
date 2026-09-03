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

type Layer = "customer" | "team" | "owner";

interface Feature {
  id: string;
  title: string;
  tagline: string;
  description: string;
  points: string[];
  status: "available" | "roadmap";
  layer: Layer;
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
    layer: "customer",
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
    layer: "customer",
    icon: IconMenuBook,
    visual: ModifierMock,
  },
  {
    id: "qr-ordering",
    title: "QR Ordering",
    tagline: "Order from the table, on their own phone",
    description: "A QR code at the table links straight to your ordering page — no app download required.",
    points: ["Uses the same ordering page as online orders", "No dedicated hardware required", "Table-specific QR codes are on our roadmap"],
    status: "roadmap",
    layer: "customer",
    icon: IconQr,
  },
  {
    id: "branding",
    title: "Restaurant Branding",
    tagline: "It looks like your restaurant, not a template",
    description: "Set your brand color and it repaints the entire ordering experience — buttons, links, highlights, all of it.",
    points: ["Logo, cover image and description supported", "Brand color applied platform-wide instantly", "Not a website builder — a focused ordering page"],
    status: "available",
    layer: "customer",
    icon: IconPalette,
    visual: BrandingMock,
  },
  {
    id: "order-management",
    title: "Order Management",
    tagline: "A queue your staff can actually run on",
    description: "Every order moves through a clear status lifecycle your team controls, from acceptance to completion.",
    points: ["Accept, prepare, ready, complete — one tap each", "Cancel and refund-status handling", "Order history stays searchable after the fact"],
    status: "available",
    layer: "team",
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
    layer: "team",
    icon: IconTruck,
    visual: DeliveryMock,
  },
  {
    id: "multi-location",
    title: "Multi-location",
    tagline: "One account, every location",
    description: "The platform's tenant architecture already supports it — a full multi-location dashboard is on our roadmap.",
    points: ["Each location keeps its own menu and orders", "Central account across locations", "Location-switcher UI is on our roadmap"],
    status: "roadmap",
    layer: "team",
    icon: IconMapPin,
  },
  {
    id: "support",
    title: "Customer Support",
    tagline: "A help center customers actually use",
    description: "A searchable knowledge base plus a ticketing system, built into the same ordering experience.",
    points: ["Searchable help articles by category", "Ticket creation, replies and resolution tracking", "Internal notes for your support team"],
    status: "available",
    layer: "team",
    icon: IconHeadset,
    visual: SupportMock,
  },
  {
    id: "analytics",
    title: "Analytics",
    tagline: "See the business, not just the orders",
    description: "Revenue, order volume, average order value and top-selling items, updated as orders come in.",
    points: ["Today and this-week performance at a glance", "Top-selling items ranked automatically", "Completed vs. cancelled order tracking"],
    status: "available",
    layer: "owner",
    icon: IconChart,
    visual: AnalyticsMock,
  },
  {
    id: "promotions",
    title: "Promotions",
    tagline: "Bring customers back with an offer",
    description: "Create discount codes that make ordering direct more attractive than ordering elsewhere — validated and priced on the server, every time.",
    points: ["Percentage or fixed-amount discount codes", "Minimum order amount and usage limits", "Optional expiry date per code"],
    status: "available",
    layer: "owner",
    icon: IconTag,
    visual: PromotionsMock,
  },
  {
    id: "loyalty",
    title: "Loyalty",
    tagline: "Reward the customers who keep coming back",
    description: "A points balance and history that gives repeat customers a reason to order direct instead of elsewhere.",
    points: ["Points balance and tier shown to customers", "Full transaction history", "Configurable earn/redeem rules on our roadmap"],
    status: "available",
    layer: "owner",
    icon: IconStar,
    visual: LoyaltyMock,
  },
  {
    id: "customers",
    title: "Customer Management",
    tagline: "Know who's actually ordering",
    description: "Every order is tied to a real customer account, so you can see order history instead of guessing.",
    points: ["Customer order history, per restaurant", "Foundation for segmentation and campaigns", "Full customer profiles are on our roadmap"],
    status: "available",
    layer: "owner",
    icon: IconUsers,
    visual: CustomersMock,
  },
];

const LAYERS: { id: Layer; eyebrow: string; title: string; description: string; tone: "default" | "surface" }[] = [
  {
    id: "customer",
    eyebrow: "What customers see",
    title: "The ordering page they land on",
    description: "Everything a customer touches between opening your link and getting a confirmation — branded as your restaurant, not a marketplace.",
    tone: "surface",
  },
  {
    id: "team",
    eyebrow: "What your team runs",
    title: "The queue that keeps service moving",
    description: "Orders don't just arrive — someone has to accept, prepare and hand them off. This is the surface built for that.",
    tone: "default",
  },
  {
    id: "owner",
    eyebrow: "What you grow with",
    title: "The numbers and the levers to move them",
    description: "Once orders are flowing, the question becomes who's ordering, how often, and what brings them back.",
    tone: "surface",
  },
];

function LayerNavigator() {
  return (
    <Reveal className="mx-auto mt-12 flex max-w-3xl flex-col gap-0 sm:flex-row sm:items-stretch sm:gap-0">
      {LAYERS.map((layer, i) => (
        <a
          key={layer.id}
          href={`#layer-${layer.id}`}
          className="group relative flex flex-1 flex-col gap-1.5 border-t border-border px-5 py-4 text-left transition-colors first:border-t-0 hover:bg-black/[0.02] sm:border-t-0 sm:border-l sm:first:border-l-0"
        >
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-primary/40 text-[10px] text-primary">
              {i + 1}
            </span>
            {layer.eyebrow}
          </span>
          <span className="text-sm text-muted transition-colors group-hover:text-foreground">{layer.title}</span>
        </a>
      ))}
    </Reveal>
  );
}

function FeatureHero({ feature }: { feature: Feature }) {
  return (
    <Reveal id={feature.id} className="scroll-mt-24">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <div className="flex flex-col items-start gap-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <feature.icon className="h-6 w-6" />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-heading text-2xl font-semibold text-foreground">{feature.title}</h3>
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
      </div>
    </Reveal>
  );
}

function FeatureRow({ feature, index }: { feature: Feature; index: number }) {
  return (
    <Reveal id={feature.id} index={index} className="scroll-mt-24">
      <Card className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <feature.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-heading text-base font-semibold text-foreground">{feature.title}</h3>
              <Badge tone={feature.status === "available" ? "success" : "warning"}>
                {feature.status === "available" ? "Available now" : "Roadmap"}
              </Badge>
            </div>
            <p className="text-xs text-muted">{feature.tagline}</p>
          </div>
        </div>
        <p className="text-sm text-muted">{feature.description}</p>
        <ul className="mt-auto flex flex-col gap-1.5 pt-2">
          {feature.points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-xs text-foreground/80">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
              {point}
            </li>
          ))}
        </ul>
      </Card>
    </Reveal>
  );
}

export function ProductPage() {
  usePageMeta({
    title: "Product — Tablecloth",
    description: "Everything a restaurant needs to sell direct: digital menu, ordering, delivery, loyalty, promotions and analytics in one platform.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Product"
          title="Look inside the machine"
          description="One platform, three vantage points — what customers see, what your team runs, and what you grow with. What's live today, and what's next — no feature marked available unless it actually works."
        />
        <LayerNavigator />
      </Section>

      {LAYERS.map((layer) => {
        const layerFeatures = FEATURES.filter((f) => f.layer === layer.id);
        const [hero, ...rest] = layerFeatures;
        return (
          <Section key={layer.id} id={`layer-${layer.id}`} tone={layer.tone} className="scroll-mt-24">
            <Reveal className="mx-auto mb-12 flex max-w-xl flex-col gap-3 text-center">
              <span className="text-sm font-semibold uppercase tracking-wide text-primary">{layer.eyebrow}</span>
              <h2 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{layer.title}</h2>
              <p className="text-sm text-muted sm:text-base">{layer.description}</p>
            </Reveal>

            <div className="flex flex-col gap-10">
              <FeatureHero feature={hero} />
              {rest.length > 0 && (
                <div className={`grid gap-6 ${rest.length === 1 ? "sm:grid-cols-1 sm:max-w-md sm:mx-auto" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
                  {rest.map((feature, i) => (
                    <FeatureRow key={feature.id} feature={feature} index={i} />
                  ))}
                </div>
              )}
            </div>
          </Section>
        );
      })}

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
