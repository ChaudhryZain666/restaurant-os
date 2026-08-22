import type { ReactNode } from "react";
import { cn, Reveal } from "@restaurant/ui";
import { Container } from "./Container";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
}) {
  return (
    <Reveal className={cn("flex flex-col gap-3", align === "center" ? "items-center text-center" : "items-start text-left")}>
      {eyebrow && <span className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</span>}
      <h2 className="font-heading text-3xl font-semibold text-foreground sm:text-4xl">{title}</h2>
      {description && <p className={cn("max-w-2xl text-base text-muted sm:text-lg", align === "center" && "mx-auto")}>{description}</p>}
    </Reveal>
  );
}

export function Section({
  id,
  className,
  children,
  tone = "default",
}: {
  id?: string;
  className?: string;
  children: ReactNode;
  tone?: "default" | "surface" | "dark";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 py-16 sm:py-24",
        tone === "surface" && "bg-surface",
        tone === "dark" && "bg-secondary text-secondary-foreground",
        className
      )}
    >
      <Container>{children}</Container>
    </section>
  );
}
