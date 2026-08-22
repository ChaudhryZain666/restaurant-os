import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { Button, Card, Reveal } from "@restaurant/ui";
import { Section, SectionHeading } from "../components/Section";
import { IconArrowRight, IconMapPin, IconMenuBook, IconStore, IconTruck, IconUsers } from "../components/icons";
import { usePageMeta } from "../hooks/usePageMeta";

interface Solution {
  id: string;
  title: string;
  description: string;
  highlights: string[];
  icon: (p: { className?: string }) => ReactNode;
}

const SOLUTIONS: Solution[] = [
  {
    id: "independent",
    title: "Independent Restaurants",
    description: "You built the restaurant. You shouldn't have to rent your customer relationship back from a marketplace to sell to them online.",
    highlights: ["Your own branded ordering page", "Direct customer relationships and order history", "No per-order commission on direct sales"],
    icon: IconStore,
  },
  {
    id: "cafes",
    title: "Cafés",
    description: "Fast counter ordering with a menu that's simple to scan and quick to reorder from.",
    highlights: ["Lightweight menu, quick checkout", "Modifiers for milk, size, extras", "QR ordering for table service"],
    icon: IconMenuBook,
  },
  {
    id: "takeaways",
    title: "Takeaways",
    description: "Built around pickup speed — customers order ahead, you prep, they grab it and go.",
    highlights: ["Pickup-first ordering flow", "Live order status so timing stays predictable", "Order-again for repeat regulars"],
    icon: IconTruck,
  },
  {
    id: "fast-food",
    title: "Fast Food",
    description: "High order volume needs a queue that's fast to operate, not just fast to look at.",
    highlights: ["Clear, single-tap status transitions", "Availability toggles for sold-out items", "Analytics on your busiest hours"],
    icon: IconUsers,
  },
  {
    id: "pizzerias",
    title: "Pizzerias",
    description: "Modifier groups built for exactly this — sizes, crusts, toppings, without spreadsheet-style menus.",
    highlights: ["Required and optional modifier groups", "Per-option price adjustments", "Combos and multi-topping items"],
    icon: IconMenuBook,
  },
  {
    id: "multi-location",
    title: "Multiple Locations",
    description: "Each location keeps its own menu and orders, under one account you can actually keep track of.",
    highlights: ["Per-location menus and settings", "Centralized account access", "Full location switcher on our roadmap"],
    icon: IconMapPin,
  },
  {
    id: "growing",
    title: "Growing Restaurant Businesses",
    description: "Start with one location and a simple menu — the same platform scales as the business does.",
    highlights: ["No re-platforming as you add locations", "Analytics that grow with your order volume", "Loyalty points live today, promotions on our roadmap"],
    icon: IconStore,
  },
];

export function SolutionsPage() {
  usePageMeta({
    title: "Solutions — Tablecloth",
    description: "Online ordering built for independent restaurants, cafés, pizzerias and takeaway spots — whatever kind of food business you run.",
  });
  return (
    <>
      <Section className="pt-14 sm:pt-20">
        <SectionHeading
          eyebrow="Solutions"
          title="Built for how your restaurant actually operates"
          description="Different restaurants order differently. Here's how Tablecloth fits yours."
        />
      </Section>

      <Section tone="surface">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((solution, i) => (
            <Reveal key={solution.id} id={solution.id} index={i} className="scroll-mt-24">
              <Card className="flex h-full flex-col gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <solution.icon className="h-5 w-5" />
                </span>
                <h3 className="font-heading text-lg font-semibold text-foreground">{solution.title}</h3>
                <p className="text-sm text-muted">{solution.description}</p>
                <ul className="mt-auto flex flex-col gap-1.5 pt-2">
                  {solution.highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-xs text-foreground/80">
                      <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
                      {h}
                    </li>
                  ))}
                </ul>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

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
