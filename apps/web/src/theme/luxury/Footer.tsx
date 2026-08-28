import type { FooterProps } from "../types";
import { PinIcon } from "../icons";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};
const WEEKDAY_ORDER = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const TODAY_KEY = WEEKDAY_ORDER[(new Date().getDay() + 6) % 7];

/** Luxury — a quiet, structured close: identity in its own column beside contact details and the
 *  full week's hours (today set apart in the foreground color, the rest muted) — real hierarchy
 *  via aligned columns, never a single centered sentence. Stays in the page's own light, hairline
 *  register rather than switching to a dark band. */
export function LuxuryFooter({ restaurant, hideBranding }: FooterProps) {
  const today = restaurant?.settings.businessHours.find((d) => d.day === TODAY_KEY);
  const address = [restaurant?.address, restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  return (
    <footer className="-mx-4 mt-20 border-t border-border px-5 py-14 sm:-mx-6 sm:px-10 sm:py-18">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 sm:grid-cols-[1.3fr_1fr_1.2fr] sm:gap-12">
        <div className="flex flex-col gap-3">
          <span className="font-heading text-xl font-normal text-foreground">{restaurant?.name ?? "Restaurant"}</span>
          {restaurant?.description && <p className="max-w-xs text-[13px] leading-relaxed text-muted">{restaurant.description}</p>}
        </div>

        {(address || restaurant?.phone) && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted">Visit</span>
            <div className="flex flex-col gap-1.5 text-[13px] text-foreground">
              {address && (
                <span className="flex items-start gap-1.5">
                  <PinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                  {address}
                </span>
              )}
              {restaurant?.phone && <span>{restaurant.phone}</span>}
            </div>
          </div>
        )}

        {today && (
          <div className="flex flex-col gap-3">
            <span className="text-xs font-medium uppercase tracking-[0.22em] text-muted">Hours</span>
            <div className="flex flex-col gap-1 text-[13px]">
              {WEEKDAY_ORDER.map((key) => {
                const day = restaurant?.settings.businessHours.find((d) => d.day === key);
                if (!day) return null;
                const isToday = key === TODAY_KEY;
                return (
                  <div key={key} className={`flex justify-between gap-6 ${isToday ? "text-foreground" : "text-muted"}`}>
                    <span className={isToday ? "font-medium" : undefined}>{WEEKDAY_LABELS[key]}</span>
                    <span>{day.isClosed ? "Closed" : `${day.open} – ${day.close}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {!hideBranding && (
        <p className="mx-auto mt-12 max-w-6xl border-t border-border pt-6 text-[11px] uppercase tracking-[0.18em] text-muted">
          Powered by a platform built for real restaurants
        </p>
      )}
    </footer>
  );
}
