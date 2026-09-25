import { describe, expect, it } from "@jest/globals";
import { DoorDashProvider } from "./DoorDashProvider.js";
import type { MarketplaceProvider } from "./MarketplaceProvider.js";

describe("DoorDashProvider capability declaration", () => {
  it("declares orderDeny:false — DoorDash's documented order-event model has no explicit deny action", () => {
    const provider = new DoorDashProvider("dev_id", "key_id", "c2lnbmluZy1zZWNyZXQ=");
    expect(provider.capabilities.orderDeny).toBe(false);
  });

  it("Phase 78 — declares connect.mechanism as not_available, never a fabricated OAuth flow — DoorDash's real SSIO onboarding exists but its technical parameters aren't independently confirmable yet", () => {
    const provider = new DoorDashProvider("dev_id", "key_id", "c2lnbmluZy1zZWNyZXQ=");
    expect(provider.capabilities.connect.mechanism).toBe("not_available");
    expect(provider.capabilities.connect.unavailableReason).toBeTruthy();
  });

  it("denyOrder throws a clear unsupported_capability error rather than silently no-op'ing or crashing unpredictably", async () => {
    // Typed as the interface (not the concrete class) so this call site checks against
    // MarketplaceProvider's full 3-arg denyOrder signature, matching how every real caller
    // (marketplaceOrderIngestion.service.ts) reaches this method — DoorDashProvider's own concrete
    // override declares 0 params since it never uses them, the same established
    // omit-unused-interface-params convention ManualDispatchProvider.ts already uses.
    const provider: MarketplaceProvider = new DoorDashProvider("dev_id", "key_id", "c2lnbmluZy1zZWNyZXQ=");
    await expect(provider.denyOrder("store_1", "order_1", "some reason")).rejects.toMatchObject({
      code: "unsupported_capability",
    });
  });
});
