/**
 * Phase 89 — courier APIs (Uber Direct) need phone numbers in international E.164 form ("+12125550100")
 * and countries as ISO 3166-1 alpha-2 codes ("US"). This platform stores both as free text, so they
 * are normalized at the boundary — by fixed rules only. Nothing here guesses: a number that can't be
 * normalized unambiguously is rejected with a message saying how to enter it, never "fixed up".
 */

export type NormalizedPhone = { ok: true; e164: string } | { ok: false; reason: string };

const PHONE_FORMAT_HINT = "Use international format, starting with + and the country code (for example +1 212 555 0100 or +44 20 7946 0000).";

/** Countries sharing the North American Numbering Plan: a 10-digit national number there is
 *  unambiguous (+1 is the only possible country code). Every other country needs the + form. */
const NANP_COUNTRIES = new Set(["US", "CA", "PR", "GU", "VI", "AS", "MP"]);

export function normalizePhone(raw: string | null | undefined, countryCode?: string | null): NormalizedPhone {
  const input = (raw ?? "").trim();
  if (!input) return { ok: false, reason: `A phone number is required. ${PHONE_FORMAT_HINT}` };
  // Separators people type; anything else (letters, "ext", "#") makes the number ambiguous.
  const compact = input.replace(/[\s().\-/]/g, "");
  if (!/^\+?\d+$/.test(compact) && !/^00\d+$/.test(compact)) {
    return { ok: false, reason: `"${input}" isn't a phone number we can use. ${PHONE_FORMAT_HINT}` };
  }

  let international: string | null = null;
  if (compact.startsWith("+")) international = compact.slice(1);
  else if (compact.startsWith("00")) international = compact.slice(2);

  if (international !== null) {
    if (/^[1-9]\d{7,14}$/.test(international)) return { ok: true, e164: `+${international}` };
    return { ok: false, reason: `"${input}" doesn't look like a complete international number. ${PHONE_FORMAT_HINT}` };
  }

  if (countryCode && NANP_COUNTRIES.has(countryCode.toUpperCase())) {
    if (/^[2-9]\d{9}$/.test(compact)) return { ok: true, e164: `+1${compact}` };
    if (/^1[2-9]\d{9}$/.test(compact)) return { ok: true, e164: `+${compact}` };
  }
  return { ok: false, reason: `"${input}" has no country code. ${PHONE_FORMAT_HINT}` };
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "US",
  us: "US",
  "united states of america": "US",
  america: "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  uae: "AE",
  "south korea": "KR",
  korea: "KR",
};

/** Codes ICU will name but that are not assignable ISO 3166-1 countries: user-assigned ranges and
 *  the exceptionally reserved ones (UK, EU, UN…). Uber and other APIs reject them. */
function isAssignableCode(code: string): boolean {
  if (code === "AA" || code === "ZZ" || /^Q[M-Z]$/.test(code) || /^X[A-Z]$/.test(code)) return false;
  if (["UK", "EU", "EZ", "UN", "AC", "CP", "DG", "EA", "IC", "TA"].includes(code)) return false;
  // Deprecated codes (ZR, BU, TP, …) canonicalize to their successor; keep only the current code so
  // a retired code can never shadow the real country name.
  try {
    return new Intl.Locale(`und-${code}`).region === code;
  } catch {
    return false;
  }
}

let countryNames: Map<string, string> | null = null;

/** English region name → code, for every ISO 3166-1 alpha-2 code the runtime's ICU knows. */
function englishCountryNames(): Map<string, string> {
  if (countryNames) return countryNames;
  countryNames = new Map();
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      let name: string | undefined;
      try {
        name = display.of(code);
      } catch {
        continue;
      }
      if (name && name !== code && isAssignableCode(code)) countryNames.set(simplify(name), code);
    }
  }
  return countryNames;
}

function simplify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,']/g, "")
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** ISO 3166-1 alpha-2 code for a stored country ("US", "us", "United States", "U.S.A."), or null when
 *  it isn't recognizable. A two-letter value is accepted only if it is a real region code. */
export function normalizeCountryCode(raw: string | null | undefined): string | null {
  const value = simplify(raw ?? "");
  if (!value) return null;
  if (COUNTRY_ALIASES[value]) return COUNTRY_ALIASES[value];
  const names = englishCountryNames();
  if (/^[a-z]{2}$/.test(value)) {
    const code = value.toUpperCase();
    return [...names.values()].includes(code) ? code : null;
  }
  return names.get(value) ?? null;
}
