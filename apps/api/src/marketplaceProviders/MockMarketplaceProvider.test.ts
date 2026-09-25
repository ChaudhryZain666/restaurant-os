import { describe, expect, it } from "@jest/globals";
import { MockMarketplaceProvider } from "./MockMarketplaceProvider.js";

describe("MockMarketplaceProvider capability declaration", () => {
  it("Phase 78 — declares connect.mechanism as oauth_redirect for uber_eats, matching the live adapter — uberEatsConnect.ts has its own mock-mode branch, so the real OAuth flow is genuinely exercisable here", () => {
    const provider = new MockMarketplaceProvider("uber_eats", "mock-secret");
    expect(provider.capabilities.connect).toEqual({ mechanism: "oauth_redirect" });
  });

  it("Phase 78 — declares connect.mechanism as manual_store_id for doordash/foodpanda — the sanctioned dev/test backdoor for their order-ingestion pipeline, since neither has a real connect flow to mock", () => {
    for (const name of ["doordash", "foodpanda"] as const) {
      const provider = new MockMarketplaceProvider(name, "mock-secret");
      expect(provider.capabilities.connect).toEqual({ mechanism: "manual_store_id" });
    }
  });
});
