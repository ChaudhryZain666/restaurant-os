import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Badge, Card, Reveal } from "@restaurant/ui";
import { IconArrowRight } from "./icons";

export function FeatureCard({
  icon,
  title,
  description,
  status,
  index = 0,
  id,
  to,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  status?: "available" | "roadmap";
  index?: number;
  id?: string;
  to: string;
}) {
  return (
    <Reveal as="div" index={index} id={id} className="scroll-mt-24">
      <Link to={to} className="group block h-full focus-visible:outline-none">
        <Card className="flex h-full flex-col gap-3 transition-all duration-normal group-hover:-translate-y-1 group-hover:shadow-elevated group-focus-visible:-translate-y-1 group-focus-visible:shadow-elevated">
          <div className="flex items-start justify-between gap-2">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors duration-normal group-hover:bg-primary group-hover:text-primary-foreground">
              {icon}
            </span>
            {status === "roadmap" && (
              <Badge tone="warning" className="shrink-0">
                Roadmap
              </Badge>
            )}
          </div>
          <h3 className="font-heading text-lg font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
          <span className="mt-auto flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition-opacity duration-normal group-hover:opacity-100 group-focus-visible:opacity-100">
            Learn more <IconArrowRight className="h-3.5 w-3.5" />
          </span>
        </Card>
      </Link>
    </Reveal>
  );
}
