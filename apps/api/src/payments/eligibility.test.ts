import { describe, expect, it } from "@jest/globals";
import { resolveEligiblePaymentProvider } from "./eligibility.js";

describe("resolveEligiblePaymentProvider", () => {
  it.each(["PK", "pk", "Pakistan", " pakistan  ", "PAK"])("routes %s to safepay", (country) => {
    expect(resolveEligiblePaymentProvider({ country })?.providerName).toBe("safepay");
  });

  it.each(["USA", "US", "United Kingdom", "GB", "Canada"])("routes %s to stripe", (country) => {
    expect(resolveEligiblePaymentProvider({ country })?.providerName).toBe("stripe");
  });

  it.each([null, undefined, "", "   "])("returns null for an unknown/unset country (%s) rather than guessing", (country) => {
    expect(resolveEligiblePaymentProvider({ country })).toBeNull();
  });

  it.each(["Iran", "IR", "North Korea", "Cuba", "Syria"])("returns null for a Stripe-unsupported country (%s)", (country) => {
    expect(resolveEligiblePaymentProvider({ country })).toBeNull();
  });

  it("returns methods informational metadata alongside the provider name", () => {
    const result = resolveEligiblePaymentProvider({ country: "PK" });
    expect(result?.methods).toEqual(expect.arrayContaining(["card", "raast"]));
  });
});
