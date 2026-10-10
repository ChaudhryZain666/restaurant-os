import { describe, expect, it } from "@jest/globals";
import { normalizeCountryCode, normalizePhone } from "./contactNormalization.js";

// Phase 89 — courier contact details are normalized by fixed rules only; anything ambiguous is
// rejected with instructions, never guessed.
describe("normalizePhone", () => {
  it("accepts international numbers in + or 00 form, with any common separators", () => {
    expect(normalizePhone("+44 20 7946 0000")).toEqual({ ok: true, e164: "+442079460000" });
    expect(normalizePhone("0044 (20) 7946-0000")).toEqual({ ok: true, e164: "+442079460000" });
    expect(normalizePhone("+92 300 1234567", "PK")).toEqual({ ok: true, e164: "+923001234567" });
  });

  it("converts a 10-digit US/Canada national number, the one unambiguous national form", () => {
    expect(normalizePhone("(212) 555-0100", "US")).toEqual({ ok: true, e164: "+12125550100" });
    expect(normalizePhone("1 212 555 0100", "CA")).toEqual({ ok: true, e164: "+12125550100" });
  });

  it("refuses to guess a country code for a national number anywhere else, or with no country", () => {
    const pk = normalizePhone("0300 1234567", "PK");
    expect(pk.ok).toBe(false);
    expect(!pk.ok && pk.reason).toMatch(/no country code.*international format/);
    expect(normalizePhone("212-555-0100").ok).toBe(false);
  });

  it("rejects incomplete, malformed or annotated numbers with an actionable message", () => {
    for (const bad of ["+0123456789", "+1234", "+1 212 555 0100 ext 5", "call me", ""]) {
      const result = normalizePhone(bad, "US");
      expect(result.ok).toBe(false);
      expect(!result.ok && result.reason).toMatch(/international format/);
    }
    expect(normalizePhone(undefined).ok).toBe(false);
  });
});

describe("normalizeCountryCode", () => {
  it("accepts ISO codes and English country names in common spellings", () => {
    expect(normalizeCountryCode("US")).toBe("US");
    expect(normalizeCountryCode("us")).toBe("US");
    expect(normalizeCountryCode("United States")).toBe("US");
    expect(normalizeCountryCode("U.S.A.")).toBe("US");
    expect(normalizeCountryCode("United Kingdom")).toBe("GB");
    expect(normalizeCountryCode("UK")).toBe("GB");
    expect(normalizeCountryCode("Pakistan")).toBe("PK");
    expect(normalizeCountryCode("  germany ")).toBe("DE");
    // Names whose retired codes (ZR, BU, TP, YU, CS…) must never win over the current one.
    expect(normalizeCountryCode("Congo - Kinshasa")).toBe("CD");
    expect(normalizeCountryCode("Myanmar (Burma)")).toBe("MM");
    expect(normalizeCountryCode("Timor-Leste")).toBe("TL");
    expect(normalizeCountryCode("France")).toBe("FR");
  });

  it("returns null for anything it can't identify, instead of guessing", () => {
    expect(normalizeCountryCode("Narnia")).toBeNull();
    expect(normalizeCountryCode("ZZ")).toBeNull();
    expect(normalizeCountryCode("ZR")).toBeNull();
    expect(normalizeCountryCode("EU")).toBeNull();
    expect(normalizeCountryCode("")).toBeNull();
    expect(normalizeCountryCode(null)).toBeNull();
  });
});
