import { describe, expect, it } from "@jest/globals";
import { FoodpandaProvider } from "./FoodpandaProvider.js";

describe("FoodpandaProvider capability declaration", () => {
  it("Phase 78 — declares connect.mechanism as platform_admin_managed, never a fabricated restaurant-facing OAuth login — foodpanda only offers partner-level client_credentials, valid across a whole chainID", () => {
    const provider = new FoodpandaProvider("client_id", "client_secret", "webhook_token");
    expect(provider.capabilities.connect.mechanism).toBe("platform_admin_managed");
    expect(provider.capabilities.connect.unavailableReason).toBeTruthy();
  });
});
