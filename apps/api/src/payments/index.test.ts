import { shouldWarnAboutMockPaymentProviderInProduction } from "./index.js";

/** Phase 83 hardening — a forgotten PAYMENT_PROVIDER=stripe/safepay in production doesn't fail
 *  loudly: the mock provider still "succeeds," letting real customers believe they paid while no
 *  real money ever moves. */
describe("shouldWarnAboutMockPaymentProviderInProduction", () => {
  it("warns when production resolves to the mock provider", () => {
    expect(shouldWarnAboutMockPaymentProviderInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production resolves to a real provider", () => {
    expect(shouldWarnAboutMockPaymentProviderInProduction("production", "stripe")).toBe(false);
    expect(shouldWarnAboutMockPaymentProviderInProduction("production", "safepay")).toBe(false);
  });

  it("never warns outside production, regardless of provider", () => {
    expect(shouldWarnAboutMockPaymentProviderInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockPaymentProviderInProduction("test", "mock")).toBe(false);
  });
});
