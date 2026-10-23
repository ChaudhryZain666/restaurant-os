import { describe, expect, it } from "@jest/globals";
import { NEUTRAL_FAVICON, faviconFor } from "./brandFavicon";

const base = { name: "Northstar", hidePlatformBranding: false, brandedLogin: false, storefrontBranding: false };

describe("faviconFor (white-label tab icon)", () => {
  it("keeps the platform default without white-label branding", () => {
    expect(faviconFor(null, "https://r.example.com/logo.png")).toBeNull();
    expect(faviconFor(base, "https://r.example.com/logo.png")).toBeNull();
  });

  it("uses the agency logo under storefront branding", () => {
    expect(faviconFor({ ...base, storefrontBranding: true, logo: "https://a.example.com/a.png" }, null)).toBe("https://a.example.com/a.png");
  });

  it("never shows the platform icon when platform branding is hidden", () => {
    expect(faviconFor({ ...base, hidePlatformBranding: true }, "https://r.example.com/logo.png")).toBe("https://r.example.com/logo.png");
    expect(faviconFor({ ...base, hidePlatformBranding: true }, null)).toBe(NEUTRAL_FAVICON);
  });

  it("ignores non-https logos", () => {
    expect(faviconFor({ ...base, storefrontBranding: true, logo: "http://a.example.com/a.png" }, null)).toBeNull();
    expect(faviconFor({ ...base, hidePlatformBranding: true }, "javascript:alert(1)")).toBe(NEUTRAL_FAVICON);
  });
});
