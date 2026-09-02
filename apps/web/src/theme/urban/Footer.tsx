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

/** Urban — a dark structured block closing the page, opened by the same thick primary rule the
 *  header uses (bookending the page in the theme's own graphic language). Three columns
 *  (identity, contact, hours) separated by real content, never a single centered sentence; today's
 *  hours are picked out with a solid color chip rather than just bolder text. */
export function UrbanFooter({ restaurant, hideBranding }: FooterProps) {
  const today = restaurant?.settings.businessHours.find((d) => d.day === TODAY_KEY);
  const address = [restaurant?.address, restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  // Phase 42 — see Cinematic's Footer.tsx: rendered as a sibling of <main>, already full-width,
  // -mx-4/-mx-6 had nothing to cancel and was pure overshoot.
  return (
    <footer className="mt-16 border-t-4 border-primary bg-secondary text-secondary-foreground">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-6 py-14 sm:grid-cols-3 sm:px-14">
        <div className="flex flex-col gap-3">
          <span className="font-heading text-xl font-black uppercase tracking-tight text-secondary-foreground">{restaurant?.name ?? "Restaurant"}</span>
          {today && (
            <span
              className={`w-fit px-2.5 py-1 text-[11px] font-black uppercase tracking-widest ${
                today.isClosed ? "bg-secondary-foreground/10 text-secondary-foreground/60" : "bg-primary text-primary-foreground"
              }`}
            >
              {today.isClosed ? "Closed today" : `Open today · ${today.open}–${today.close}`}
            </span>
          )}
        </div>

        {(address || restaurant?.phone) && (
          <div className="flex flex-col gap-2 text-sm text-secondary-foreground/75">
            <span className="text-[11px] font-black uppercase tracking-widest text-secondary-foreground/40">Find us</span>
            {address && (
              <span className="flex items-start gap-1.5">
                <PinIcon className="mt-0.5 h-4 w-4 shrink-0" />
                {address}
              </span>
            )}
            {restaurant?.phone && <span>{restaurant.phone}</span>}
          </div>
        )}

        <div className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-widest text-secondary-foreground/50">
          <span className="mb-1 text-[11px] font-black tracking-widest text-secondary-foreground/40">Hours</span>
          {Object.entries(WEEKDAY_LABELS).map(([key]) => {
            const day = restaurant?.settings.businessHours.find((d) => d.day === key);
            if (!day) return null;
            return (
              <span key={key} className={key === TODAY_KEY ? "text-secondary-foreground" : undefined}>
                {WEEKDAY_LABELS[key]} {day.isClosed ? "closed" : `${day.open}–${day.close}`}
              </span>
            );
          })}
        </div>
      </div>

      {!hideBranding && (
        <p className="mx-auto max-w-6xl border-t border-secondary-foreground/10 px-6 py-6 text-[11px] font-bold uppercase tracking-widest text-secondary-foreground/35 sm:px-14">
          Powered by a platform built for real restaurants
        </p>
      )}
    </footer>
  );
}
