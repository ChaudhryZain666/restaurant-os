import { Reveal } from "@restaurant/ui";
import { HOW_IT_WORKS_STEPS } from "../lib/content";

export function StepList({ compact = false }: { compact?: boolean }) {
  return (
    <div className="relative grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <div className="absolute left-0 right-0 top-6 hidden h-px bg-border lg:block" aria-hidden />
      {HOW_IT_WORKS_STEPS.map((step, i) => (
        <Reveal key={step.title} index={i % 3} className="relative flex flex-col gap-2">
          <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-full border-4 border-background bg-primary font-heading text-lg font-semibold text-primary-foreground">
            {i + 1}
          </span>
          <h3 className="font-heading text-lg font-semibold text-foreground">{step.title}</h3>
          {!compact && <p className="text-sm text-muted">{step.description}</p>}
        </Reveal>
      ))}
    </div>
  );
}
