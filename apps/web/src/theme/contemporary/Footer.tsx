import type { FooterProps } from "../types";
import { PinIcon } from "../icons";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};
const TODAY_KEY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];

/** Contemporary — an off-grid three-block hierarchy (identity, visit info, hours), never a single
 *  centered sentence: identity takes the wide left column while visit/hours sit in narrower columns
 *  that don't fill the remaining grid track, leaving deliberate asymmetric whitespace on the right —
 *  the same "not everything has to reach the edge" spirit as About's off-grid paragraph. */
export function ContemporaryFooter({ restaurant, hideBranding }: FooterProps) {
  const address = [restaurant?.address, restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  // Phase 42 — see Cinematic's Footer.tsx: rendered as a sibling of <main>, already full-width,
  // -mx-4/-mx-6 had nothing to cancel and was pure overshoot.
  return (
    <footer className="mt-20 border-t-2 border-foreground bg-background px-6 py-14 sm:px-14">
      <div className="grid grid-cols-1 gap-10 sm:grid-cols-12">
        <div className="flex flex-col gap-3 sm:col-span-5">
          <span className="font-heading text-2xl font-black uppercase leading-none text-foreground">{restaurant?.name ?? "Restaurant"}</span>
          {restaurant?.description && <p className="max-w-sm text-sm leading-relaxed text-muted">{restaurant.description}</p>}
        </div>

        {(address || restaurant?.phone) && (
          <div className="flex flex-col gap-2 text-sm text-foreground sm:col-span-3 sm:col-start-7">
            <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted">Visit</span>
            {address && (
              <span className="flex items-start gap-1.5">
                <PinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                {address}
              </span>
            )}
            {restaurant?.phone && <span>{restaurant.phone}</span>}
          </div>
        )}

        <div className="flex flex-col gap-1 text-xs uppercase tracking-[0.1em] text-muted sm:col-span-3 sm:col-start-10">
          <span className="mb-1 text-[10px] font-bold tracking-[0.24em] text-muted">Hours</span>
          {Object.entries(WEEKDAY_LABELS).map(([key, label]) => {
            const day = restaurant?.settings.businessHours.find((d) => d.day === key);
            if (!day) return null;
            return (
              <span key={key} className={key === TODAY_KEY ? "font-bold text-foreground" : undefined}>
                {label} {day.isClosed ? "closed" : `${day.open}–${day.close}`}
              </span>
            );
          })}
        </div>
      </div>

      {!hideBranding && (
        <p className="mt-12 border-t border-border pt-6 text-[11px] uppercase tracking-[0.18em] text-muted">
          Powered by a platform built for real restaurants
        </p>
      )}
    </footer>
  );
}
