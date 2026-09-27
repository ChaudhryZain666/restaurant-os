import { shouldWarnAboutMockInProduction } from "./index.js";

/** Phase 82 hardening — the pure decision logic behind getMenuExtractionProvider()'s production
 *  warning (unlike a misconfigured payment/storage provider, a forgotten
 *  MENU_EXTRACTION_PROVIDER_MODE=live in production fails silently WRONG, not loudly: the mock
 *  still "succeeds," producing fake placeholder rows a busy owner could publish to their real
 *  menu without noticing). */
describe("shouldWarnAboutMockInProduction", () => {
  it("warns when production is left on the mock provider", () => {
    expect(shouldWarnAboutMockInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production is correctly configured for live extraction", () => {
    expect(shouldWarnAboutMockInProduction("production", "live")).toBe(false);
  });

  it("never warns outside production, regardless of mode", () => {
    expect(shouldWarnAboutMockInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockInProduction("test", "mock")).toBe(false);
  });
});
