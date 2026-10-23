import { describe, expect, it } from "@jest/globals";
import { authBrandingFor } from "./authBranding";

const brand = {
  name: "Northstar Kitchens",
  logo: "https://cdn.example.com/n.png",
  primaryColor: "#1D4ED8",
  hidePlatformBranding: true,
  brandedLogin: true,
  storefrontBranding: true,
};

describe("authBrandingFor (white-label branded sign-in)", () => {
  it("brands sign-in only on the restaurant's own verified domain", () => {
    expect(authBrandingFor(brand, "domain")).toEqual({ name: "Northstar Kitchens", logo: "https://cdn.example.com/n.png", primaryColor: "#1D4ED8" });
  });

  it("never brands a slug URL or the shared platform host, even if a brand object is present", () => {
    expect(authBrandingFor(brand, "slug")).toBeNull();
    expect(authBrandingFor(brand, "none")).toBeNull();
  });

  it("falls back to the platform screen when the flag is off or nothing resolved (unknown/inactive domain)", () => {
    expect(authBrandingFor({ ...brand, brandedLogin: false }, "domain")).toBeNull();
    expect(authBrandingFor(null, "domain")).toBeNull();
  });

  it("drops a non-https logo and a malformed color rather than rendering them", () => {
    expect(authBrandingFor({ ...brand, logo: "javascript:alert(1)", primaryColor: "red" }, "domain")).toEqual({ name: "Northstar Kitchens" });
  });
});
