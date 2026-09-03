import { Link } from "react-router-dom";
import type { ComponentType } from "react";
import { Button, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import {
  MockFrame,
  AgencyMock,
  CheckoutMock,
  DeliveryMock,
  ModifierMock,
  OrdersMock,
} from "../components/FeatureMocks";
import { IconArrowRight } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

interface Scenario {
  id: string;
  tag: string;
  title: string;
  body: string;
  highlights: string[];
  visual: ComponentType;
}

const SCENARIOS: Scenario[] = [
  {
    id: "independent",
    tag: "Independent restaurants",
    title: "Own the relationship, not just the recipe",
    body: "You built the restaurant. You shouldn't have to rent your customer relationship back from a marketplace to sell to them online. Every order lands on a page that looks like yours — your logo, your colors, your menu — and every customer who orders becomes yours, not a platform's.",
    highlights: ["Your own branded ordering page", "Direct customer relationships and order history", "No per-order commission on direct sales"],
    visual: CheckoutMock,
  },
  {
    id: "counter-service",
    tag: "Cafés & fast food",
    title: "Built for a queue that moves fast",
    body: "Counter service lives or dies on speed — a menu that's quick to scan, modifiers that don't slow the line, and an order queue your staff can run on autopilot during a rush. QR codes at the table skip the app-download friction entirely.",
    highlights: ["Lightweight menu, quick checkout", "Modifiers for size, extras and add-ons", "QR ordering for table or counter service"],
    visual: ModifierMock,
  },
  {
    id: "pickup-heavy",
    tag: "Takeaways & pizzerias",
    title: "Order ahead, prep on schedule, hand it off",
    body: "Pickup-first businesses need timing to be predictable on both ends — customers ordering ahead, staff prepping to a queue they can see. Modifier groups built for real complexity (sizes, crusts, toppings) replace spreadsheet-style menus that break under real order volume.",
    highlights: ["Pickup-first ordering flow with live status", "Required and optional modifier groups", "Order-again for repeat regulars"],
    visual: OrdersMock,
  },
  {
    id: "growing",
    tag: "Multi-location & growing businesses",
    title: "The same platform, from one location to many",
    body: "Start with one location and a simple menu — the architecture underneath already keeps each location's menu, orders and settings separate under one account, so growth doesn't force a re-platform later. A full location-switcher dashboard is on our roadmap, not a promise we're making early.",
    highlights: ["Per-location menus and settings today", "Centralized account access", "Full location switcher on our roadmap"],
    visual: DeliveryMock,
  },
  {
    id: "agencies",
    tag: "Agencies",
    title: "One login, every client's business",
    body: "Managing ordering for several restaurants shouldn't mean juggling separate logins and separate bills. An agency account oversees every business it manages — each with its own locations, staff and owner — from a single dashboard, with consolidated billing behind it.",
    highlights: ["One dashboard across every managed business", "Each business keeps its own storefront and staff", "Consolidated agency billing"],
    visual: AgencyMock,
  },
];

function ScenarioChapter({ scenario, index }: { scenario: Scenario; index: number }) {
  const reversed = index % 2 === 1;
  return (
    <Section id={scenario.id} tone={index % 2 === 0 ? "default" : "surface"} className="scroll-mt-24">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <Reveal className={reversed ? "lg:order-2" : ""}>
          <div className="flex flex-col items-start gap-4">
            <span className="text-sm font-semibold uppercase tracking-wide text-primary">{scenario.tag}</span>
            <h2 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">{scenario.title}</h2>
            <p className="text-muted">{scenario.body}</p>
            <ul className="flex flex-col gap-2">
              {scenario.highlights.map((h) => (
                <li key={h} className="flex items-start gap-2 text-sm text-foreground/80">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {h}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal index={1} className={reversed ? "lg:order-1" : ""}>
          <div className="aspect-[4/3]">
            <MockFrame>
              <scenario.visual />
            </MockFrame>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

export function SolutionsPage() {
  usePageMeta({
    title: "Solutions — Tablecloth",
    description: "How different restaurants — independents, counter service, pickup-heavy kitchens, growing multi-location businesses and agencies — use Tablecloth.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          as="h1"
          eyebrow="Solutions"
          title="How different restaurants use the system"
          description="Same platform underneath — but a café's rush hour, a pizzeria's modifier list, and an agency's client roster don't look anything alike. Here's how each one actually uses it."
        />
        <Reveal className="mx-auto mt-8 flex max-w-2xl flex-wrap justify-center gap-2">
          {SCENARIOS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="rounded-pill border border-border bg-surface px-3.5 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:border-primary/40 hover:text-primary"
            >
              {s.tag}
            </a>
          ))}
        </Reveal>
      </Section>

      {SCENARIOS.map((scenario, i) => (
        <ScenarioChapter key={scenario.id} scenario={scenario} index={i} />
      ))}

      <Section>
        <Reveal className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-surface p-10 text-center shadow-md">
          <h2 className="font-heading text-2xl font-semibold text-foreground">Not sure which fits your restaurant?</h2>
          <p className="max-w-lg text-muted">Every plan includes the same core platform — start free and grow into it.</p>
          <Link to="/start-trial">
            <Button size="lg">
              Start Free Trial <IconArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </Reveal>
      </Section>
    </>
  );
}
