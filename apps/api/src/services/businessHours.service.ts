import type { Weekday } from "@restaurant/types";

const WEEKDAYS: readonly Weekday[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Structurally compatible with (and deliberately looser than) @restaurant/types' own
 * `BusinessHoursDay` — Mongoose's InferSchemaType widens an optional, non-required `String` field
 * on a subdocument array to `string | null | undefined` (a well-known, pre-existing Mongoose/
 * TypeScript characteristic of this codebase's other subdocument arrays too, not specific to this
 * one), so a `Restaurant.settings.businessHours` value passed in directly wouldn't satisfy the
 * stricter shared type. Both the Mongoose-inferred shape and the shared frontend/test type satisfy
 * this one.
 */
export interface BusinessHoursDayLike {
  day: Weekday;
  isClosed: boolean;
  open?: string | null;
  close?: string | null;
}

/**
 * Phase 51 — the smallest reusable mechanism for answering "is this restaurant within its
 * configured business hours right now" and "when will it next open," using the location's own
 * IANA timezone (Restaurant.settings.timezone) rather than the server's or the caller's. Pure,
 * synchronous, deterministic (a `now` instant is always explicit, defaulting to `new Date()`) —
 * no DB access, so this can run cheaply inside a request path (see orderCreation.service.ts).
 *
 * Uses the same mechanism this codebase's analytics/display code already relies on
 * (Intl.DateTimeFormat with an explicit `timeZone`) rather than adding a date/time library —
 * `dayjs` is present in node_modules only as exceljs's own transitive dependency and is not wired
 * into this project anywhere.
 */

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  weekday: Weekday;
  hour: number;
  minute: number;
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
const offsetFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = offsetFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset", year: "numeric" });
    offsetFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Decomposes a UTC instant into its local wall-clock date/time in the given IANA timezone. */
function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday").toLowerCase() as Weekday,
    hour: Number(get("hour")) % 24, // "h23" can format midnight as "24" in some ICU builds
    minute: Number(get("minute")),
  };
}

/** The UTC offset (in minutes, e.g. -300 for EST, +330 for IST) in effect at the given UTC
 *  instant, in the given IANA timezone. Positive means the zone is AHEAD of UTC. */
function utcOffsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = offsetFormatter(timeZone).formatToParts(instant);
  const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(raw);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  return sign * (hours * 60 + minutes);
}

/**
 * Converts a LOCAL wall-clock date+time in the given IANA timezone into the UTC instant it
 * represents — the reverse of what Intl.DateTimeFormat does natively. Standard technique: guess
 * the instant by treating the local values as if they were already UTC, read the real offset that
 * applies near that guess, then correct for it. Refined twice, which converges for every real-world
 * IANA zone except the (rare, sub-hour-window) moment exactly inside a DST transition itself — a
 * documented, acceptable approximation for a "next opens at" display, not for financial/legal timing.
 */
function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const naiveUtcMs = Date.UTC(year, month - 1, day, hour, minute);
  let guessMs = naiveUtcMs;
  for (let i = 0; i < 2; i++) {
    const offsetMinutes = utcOffsetMinutesAt(new Date(guessMs), timeZone);
    guessMs = naiveUtcMs - offsetMinutes * 60_000;
  }
  return new Date(guessMs);
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function dayByName(businessHours: BusinessHoursDayLike[], day: Weekday): BusinessHoursDayLike | undefined {
  return businessHours.find((d) => d.day === day);
}

function previousWeekday(day: Weekday): Weekday {
  const idx = WEEKDAYS.indexOf(day);
  return WEEKDAYS[(idx + 6) % 7];
}

/**
 * Is `now` within the period configured for `day`, given that `nowMinutes` is `now`'s own
 * minute-of-day (in the SAME local calendar day as `day`)? Handles the ordinary same-day case
 * (open <= now < close) and the "day's own period starts before midnight" half of an overnight
 * period (close <= open means it wraps past midnight, so anything from `open` to end-of-day counts).
 */
function isWithinTodaysPeriod(day: BusinessHoursDayLike | undefined, nowMinutes: number): boolean {
  if (!day || day.isClosed || !day.open || !day.close) return false;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close > open) return open <= nowMinutes && nowMinutes < close; // ordinary same-day period
  return nowMinutes >= open; // overnight period — the part of it still before midnight
}

/**
 * Is `now` within the AFTER-MIDNIGHT tail of `day`'s period (i.e. `day` is YESTERDAY relative to
 * `now`, and yesterday's hours wrapped past midnight into today)? e.g. Monday 18:00-02:00 means
 * 01:00 Tuesday is still open — Tuesday's OWN configured hours are irrelevant to that determination.
 */
function isWithinYesterdaysOvernightTail(day: BusinessHoursDayLike | undefined, nowMinutes: number): boolean {
  if (!day || day.isClosed || !day.open || !day.close) return false;
  const open = toMinutes(day.open);
  const close = toMinutes(day.close);
  if (close > open) return false; // not an overnight period at all
  return nowMinutes < close;
}

export interface HoursCheckResult {
  withinHours: boolean;
}

/**
 * Empty/unconfigured `businessHours` (the default for a restaurant that has never set any —
 * confirmed by the model default and this codebase's own seed data for secondary locations) means
 * "no hours-based restriction" — NOT "always closed." This is a deliberate backward-compatibility
 * choice: every restaurant that existed before this phase, and every restaurant that simply hasn't
 * gotten around to configuring hours yet, must keep accepting orders exactly as before (subject
 * only to orderingEnabled/temporarilyPaused, unchanged). A configured day with no entry at all in
 * a NON-empty array is treated as closed that day (the conservative reading of an admin's own
 * incomplete configuration), but a wholly-empty array is treated as unrestricted.
 */
export function isWithinBusinessHours(businessHours: BusinessHoursDayLike[], timezone: string, now: Date = new Date()): HoursCheckResult {
  if (businessHours.length === 0) return { withinHours: true };

  const local = getLocalParts(now, timezone);
  const nowMinutes = local.hour * 60 + local.minute;

  const today = dayByName(businessHours, local.weekday);
  const yesterday = dayByName(businessHours, previousWeekday(local.weekday));

  const withinHours = isWithinTodaysPeriod(today, nowMinutes) || isWithinYesterdaysOvernightTail(yesterday, nowMinutes);
  return { withinHours };
}

/**
 * The next UTC instant the restaurant will be within its configured hours, searching forward from
 * `now` through the next 8 calendar days (today + 7 more — enough to always find an answer unless
 * every single day is configured closed, in which case there IS no next-open instant to report).
 * Returns null when businessHours is empty/unconfigured (no hours restriction, so "next open" is a
 * meaningless question) or when no open period exists anywhere in the search window.
 */
export function getNextOpenAt(businessHours: BusinessHoursDayLike[], timezone: string, now: Date = new Date()): Date | null {
  if (businessHours.length === 0) return null;
  if (isWithinBusinessHours(businessHours, timezone, now).withinHours) return null;

  const local = getLocalParts(now, timezone);
  const nowMinutes = local.hour * 60 + local.minute;

  for (let offset = 0; offset <= 7; offset++) {
    // Advance the calendar date by `offset` days using the local Y/M/D (not UTC-shifted arithmetic
    // on `now` itself, which could land on the wrong local day near a timezone boundary) — a plain
    // JS Date used purely as a proleptic Gregorian calendar calculator, not as an instant.
    const candidate = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const weekday = WEEKDAYS[candidate.getUTCDay()];
    const day = dayByName(businessHours, weekday);
    if (!day || day.isClosed || !day.open) continue;

    const openMinutes = toMinutes(day.open);
    // On day 0 (today), a period that already started (openMinutes <= nowMinutes) isn't a FUTURE
    // opening — isWithinBusinessHours already established we're not currently inside it, so an
    // already-started period today must be one we're past (closed) or inside an overnight close of
    // (handled by the day-0 same-day check being skipped when it doesn't apply); either way, only a
    // period that hasn't started yet today is a valid "next open" candidate on day 0.
    if (offset === 0 && openMinutes <= nowMinutes) continue;

    const openHour = Math.floor(openMinutes / 60);
    const openMinute = openMinutes % 60;
    return zonedTimeToUtc(local.year, local.month, local.day + offset, openHour, openMinute, timezone);
  }
  return null;
}
