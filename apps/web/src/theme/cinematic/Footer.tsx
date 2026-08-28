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

/** Cinematic — a dark, structured close to the page (matching Hero/Cta's register): identity and
 *  today's hours on one side, address/contact on the other, a quiet branding line beneath — never a
 *  single centered sentence. */
export function CinematicFooter({ restaurant, hideBranding }: FooterProps) {
  const today = restaurant?.settings.businessHours.find((d) => d.day === TODAY_KEY);
  const address = [restaurant?.address, restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  return (
    <footer className="-mx-4 mt-16 bg-secondary px-6 py-14 text-secondary-foreground sm:-mx-6 sm:px-14">
      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-10 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <span className="font-heading text-lg font-semibold uppercase tracking-[0.14em]">{restaurant?.name ?? "Restaurant"}</span>
          {today && (
            <p className="text-xs text-secondary-foreground/60">
              {today.isClosed ? "Closed today" : `Open today · ${today.open} – ${today.close}`}
            </p>
          )}
        </div>

        {(address || restaurant?.phone) && (
          <div className="flex flex-col gap-1.5 text-xs text-secondary-foreground/70">
            {address && (
              <span className="flex items-center gap-1.5">
                <PinIcon className="h-3.5 w-3.5 shrink-0" />
                {address}
              </span>
            )}
            {restaurant?.phone && <span>{restaurant.phone}</span>}
          </div>
        )}

        <div className="flex flex-col gap-1.5 text-xs uppercase tracking-[0.14em] text-secondary-foreground/50 sm:items-end">
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
        <p className="mx-auto mt-10 max-w-[1600px] border-t border-secondary-foreground/10 pt-6 text-[11px] uppercase tracking-[0.18em] text-secondary-foreground/40">
          Powered by a platform built for real restaurants
        </p>
      )}
    </footer>
  );
}
