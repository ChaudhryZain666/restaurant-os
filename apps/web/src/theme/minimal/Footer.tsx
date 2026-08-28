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

/** Minimal — three plain columns under one hairline rule, no background block (unlike Cinematic's
 *  dark full-bleed close). Shares the same `max-w-5xl` / `px-4 sm:px-6` measure as the Header and
 *  MenuPage's own content column, so the page's left/right edges never move from top to bottom.
 *  Identity + today's line on the left, address/contact in the middle, the full week set
 *  right-aligned on the right like a small printed schedule — alignment carries the hierarchy, not
 *  color or weight (only today's row gets `text-foreground`; every other row stays `text-muted`).
 *  Respects `hideBranding` — the platform line never appears on a white-labeled domain. */
export function MinimalFooter({ restaurant, hideBranding }: FooterProps) {
  const today = restaurant?.settings.businessHours.find((d) => d.day === TODAY_KEY);
  const address = [restaurant?.address, restaurant?.city, restaurant?.state].filter(Boolean).join(", ");

  return (
    <footer className="border-t border-border">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-3 sm:gap-8">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium tracking-[0.06em] text-foreground">{restaurant?.name ?? "Restaurant"}</span>
            {today && (
              <span className="text-[13px] text-muted">
                {today.isClosed ? "Closed today" : `Open today, ${today.open} to ${today.close}`}
              </span>
            )}
          </div>

          {(address || restaurant?.phone) && (
            <div className="flex flex-col gap-1.5 text-[13px] text-muted">
              {address && (
                <span className="flex items-start gap-1.5">
                  <PinIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {address}
                </span>
              )}
              {restaurant?.phone && <span>{restaurant.phone}</span>}
            </div>
          )}

          <div className="flex flex-col gap-1 text-[13px] sm:items-end">
            {Object.entries(WEEKDAY_LABELS).map(([key, label]) => {
              const day = restaurant?.settings.businessHours.find((d) => d.day === key);
              if (!day) return null;
              return (
                <span key={key} className={key === TODAY_KEY ? "text-foreground" : "text-muted"}>
                  {label} · {day.isClosed ? "closed" : `${day.open}–${day.close}`}
                </span>
              );
            })}
          </div>
        </div>

        {!hideBranding && (
          <p className="mt-12 border-t border-border pt-6 text-[11px] tracking-[0.04em] text-muted">
            Powered by a platform built for real restaurants
          </p>
        )}
      </div>
    </footer>
  );
}
