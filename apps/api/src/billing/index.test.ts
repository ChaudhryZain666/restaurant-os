import { shouldWarnAboutMockBillingProviderInProduction } from "./index.js";

/** Phase 83 hardening — a forgotten BILLING_PROVIDER=paddle in production doesn't fail loudly: a
 *  restaurant/agency could "subscribe" through the mock billing flow and receive full paid-tier
 *  entitlements while GarnishTable is never actually paid. */
describe("shouldWarnAboutMockBillingProviderInProduction", () => {
  it("warns when production resolves to the mock provider", () => {
    expect(shouldWarnAboutMockBillingProviderInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production resolves to the real provider", () => {
    expect(shouldWarnAboutMockBillingProviderInProduction("production", "paddle")).toBe(false);
  });

  it("never warns outside production, regardless of mode", () => {
    expect(shouldWarnAboutMockBillingProviderInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockBillingProviderInProduction("test", "mock")).toBe(false);
  });
});
