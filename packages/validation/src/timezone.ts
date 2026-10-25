import { z } from "zod";

/**
 * A real IANA timezone (e.g. "Asia/Karachi", "America/Chicago"). Business hours — and therefore
 * whether a restaurant accepts orders at all — are evaluated with Intl.DateTimeFormat in this zone,
 * which throws on an unknown name, so an invalid value would make every order for that restaurant
 * fail. Uses the runtime's own timezone database (no extra dependency).
 */
export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** For settings a person edits: an unknown zone is a 400 with a clear message. */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isValidTimeZone, { message: "Unknown timezone — use an IANA name such as Asia/Karachi" });

/** For self-serve signup, where the zone comes from the owner's browser: an unrecognised value is
 *  dropped (the restaurant keeps the UTC default, editable in Settings) rather than failing signup. */
export const browserTimezoneSchema = z
  .string()
  .max(64)
  .optional()
  .transform((v) => (v && isValidTimeZone(v) ? v : undefined));
