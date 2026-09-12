import { useEffect, useRef, useState } from "react";
import type { Restaurant, RestaurantStatus } from "@restaurant/types";
import { useActiveLocationId, useLocation as useActiveLocationContext } from "../context/LocationContext";
import { useRestaurantSettings } from "../context/RestaurantSettingsContext";
import { describeAvailability } from "@restaurant/utils";
import { IconChevronDown, IconStore } from "./icons";

const STATUS_LABEL: Record<RestaurantStatus, string> = {
  active: "Live",
  pending: "Not published",
  suspended: "Suspended",
};

const STATUS_DOT: Record<RestaurantStatus, string> = {
  active: "bg-success",
  pending: "bg-warning",
  suspended: "bg-danger",
};

/**
 * Phase 71 — replaces the plain native `<select>` location switcher (both the desktop header's and
 * the mobile drawer's copies used the same bare select) with a real disclosure: a button that always
 * answers "which restaurant/location am I looking at right now" (the active location's name plus its
 * genuine live open/closed/paused status, via RestaurantSettingsContext — not fabricated), opening a
 * list of every other location with its publish status (the only per-location signal available
 * without an extra fetch per location — see this file's own restraint here, not inventing live hours
 * for locations that aren't the active one).
 *
 * Deliberately NOT a modal: a listbox disclosure is expected to let Tab move focus past it to the
 * rest of the page (unlike the Menu Builder's item-editor/preview dialogs, which correctly DO trap
 * focus) — only Escape-to-close-and-return-focus and click-outside-to-close apply here, per ARIA
 * disclosure-pattern conventions.
 *
 * Renders nothing at all for a single-location business (per Section 9's "don't complicate the
 * single-location interface") — LocationContext's own `locations` array is empty for that case by
 * construction, so callers should keep gating on `locations.length > 1` same as before this
 * component existed.
 */
export function LocationSwitcher({ theme = "light" }: { theme?: "light" | "dark" }) {
  const { activeLocationId, locations, switchLocation } = useActiveLocationContext();
  const currentRestaurantId = useActiveLocationId();
  const { restaurant: activeRestaurant, availability } = useRestaurantSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (locations.length <= 1) return null;

  const isDark = theme === "dark";
  const activeName = activeRestaurant?.name ?? locations.find((l) => l.id === currentRestaurantId)?.name ?? "Select location";
  const availabilityLabel = activeRestaurant ? describeAvailability(availability, activeRestaurant.settings.timezone) : null;

  function select(loc: Restaurant) {
    switchLocation(loc.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Switch location (currently ${activeName})`}
        className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors duration-fast ${
          isDark
            ? "text-sidebar-foreground hover:bg-sidebar-hover"
            : "border border-border bg-background text-foreground hover:bg-black/[0.03]"
        }`}
      >
        <IconStore className={`h-4 w-4 shrink-0 ${isDark ? "text-sidebar-muted" : "text-muted"}`} />
        <span className="min-w-0">
          <span className="block max-w-[10rem] truncate font-medium leading-tight">{activeName}</span>
          {availabilityLabel && (
            <span className={`flex items-center gap-1 text-xs leading-tight ${isDark ? "text-sidebar-muted" : "text-muted"}`}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  availability?.status === "open" || !availability ? "bg-success" : availability.status === "paused" ? "bg-warning" : "bg-muted"
                }`}
              />
              {availabilityLabel}
            </span>
          )}
        </span>
        <IconChevronDown className={`ml-auto h-4 w-4 shrink-0 transition-transform duration-fast ${open ? "rotate-180" : ""} ${isDark ? "text-sidebar-muted" : "text-muted"}`} />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Switch location"
          className="absolute left-0 top-full z-50 mt-1.5 w-64 origin-top-left animate-scale-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated"
        >
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {locations.length} location{locations.length === 1 ? "" : "s"}
          </p>
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {locations.map((loc) => {
              const isActive = loc.id === activeLocationId;
              return (
                <li key={loc.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => select(loc)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-fast ${
                      isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-black/[0.04]"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[loc.status]}`} />
                    <span className="min-w-0 flex-1 truncate font-medium">{loc.name}</span>
                    <span className="shrink-0 text-xs text-muted">{STATUS_LABEL[loc.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
