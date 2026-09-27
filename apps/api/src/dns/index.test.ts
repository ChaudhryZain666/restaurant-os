import { shouldWarnAboutMockDnsVerifierInProduction } from "./index.js";

/** Phase 83 hardening — a forgotten DNS_VERIFIER=node in production doesn't fail loudly: the mock
 *  verifier would report every custom-domain claim as "verified" without ever checking real DNS,
 *  a genuine domain-ownership-verification bypass. */
describe("shouldWarnAboutMockDnsVerifierInProduction", () => {
  it("warns when production is left on the mock verifier", () => {
    expect(shouldWarnAboutMockDnsVerifierInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production is correctly configured for the real verifier", () => {
    expect(shouldWarnAboutMockDnsVerifierInProduction("production", "node")).toBe(false);
  });

  it("never warns outside production, regardless of mode", () => {
    expect(shouldWarnAboutMockDnsVerifierInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockDnsVerifierInProduction("test", "mock")).toBe(false);
  });
});
