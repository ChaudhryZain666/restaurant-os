import { describe, expect, it } from "@jest/globals";
import { isPlatformStorefrontHost } from "./platformHost";

describe("isPlatformStorefrontHost (Phase 88)", () => {
  it("recognises the storefront's own platform hostname from VITE_SITE_URL", () => {
    expect(isPlatformStorefrontHost("order.garnishtable.com", "https://order.garnishtable.com")).toBe(true);
    expect(isPlatformStorefrontHost("ORDER.garnishtable.com", "https://order.garnishtable.com/")).toBe(true);
  });

  it("treats every other hostname as a possible restaurant custom domain", () => {
    expect(isPlatformStorefrontHost("orders.wildwood-kitchen.com", "https://order.garnishtable.com")).toBe(false);
    expect(isPlatformStorefrontHost("garnishtable.com", "https://order.garnishtable.com")).toBe(false);
  });

  it("never skips the lookup when the platform origin is unknown or malformed", () => {
    expect(isPlatformStorefrontHost("order.garnishtable.com", undefined)).toBe(false);
    expect(isPlatformStorefrontHost("order.garnishtable.com", "")).toBe(false);
    expect(isPlatformStorefrontHost("order.garnishtable.com", "not a url")).toBe(false);
  });
});
