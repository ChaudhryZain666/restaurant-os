import { shouldWarnAboutMockMarketplaceModeInProduction } from "./index.js";

/** Phase 83 hardening — a forgotten MARKETPLACE_PROVIDER_MODE=live in production doesn't fail
 *  loudly: every provider name would silently resolve to the mock driver instead of real Uber
 *  Eats/DoorDash/foodpanda traffic. */
describe("shouldWarnAboutMockMarketplaceModeInProduction", () => {
  it("warns when production is left on mock mode", () => {
    expect(shouldWarnAboutMockMarketplaceModeInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production is correctly configured for live mode", () => {
    expect(shouldWarnAboutMockMarketplaceModeInProduction("production", "live")).toBe(false);
  });

  it("never warns outside production, regardless of mode", () => {
    expect(shouldWarnAboutMockMarketplaceModeInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockMarketplaceModeInProduction("test", "mock")).toBe(false);
  });
});
