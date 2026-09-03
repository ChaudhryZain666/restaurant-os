import type { ReactNode } from "react";
import { cn, Reveal } from "@restaurant/ui";
import { Container } from "./Container";

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as = "h2",
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  align?: "center" | "left";
  /** Every marketing page but Home currently renders zero <h1> elements — every page opens with
   *  this component, always as h2, which never gave the page a real top-level heading. Pass
   *  as="h1" on a page's first (and only its first) SectionHeading to fix that; every other usage
   *  on the same page stays h2. */
  as?: "h1" | "h2";
}) {
  const Heading = as;
  return (
    <Reveal className={cn("flex flex-col gap-3", align === "center" ? "items-center text-center" : "items-start text-left")}>
      {eyebrow && <span className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</span>}
      <Heading className="font-heading text-3xl font-semibold text-foreground sm:text-4xl">{title}</Heading>
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
