import { describe, expect, it } from "@jest/globals";
import { PLATFORM_BRAND_NAME, platformBrandName } from "./platformHost";

// QA-009 — order.garnishtable.com/ showed an "R / Restaurant" placeholder header.
describe("platform brand on pages with no restaurant (QA-009)", () => {
  const siteUrl = "https://order.garnishtable.com";

  it("the platform's own storefront host shows the platform name", () => {
    expect(platformBrandName({ hasRestaurant: false, hostname: "order.garnishtable.com", siteUrl })).toBe(PLATFORM_BRAND_NAME);
  });

  it("a restaurant page never shows platform branding in its header", () => {
    expect(platformBrandName({ hasRestaurant: true, hostname: "order.garnishtable.com", siteUrl })).toBeUndefined();
  });

  it("a custom or agency domain never shows platform branding, even with no restaurant", () => {
    expect(platformBrandName({ hasRestaurant: false, hostname: "order.joes-diner.com", siteUrl })).toBeUndefined();
    expect(platformBrandName({ hasRestaurant: false, hostname: "food.agency.example", siteUrl })).toBeUndefined();
  });

  it("with no site URL configured nothing is assumed", () => {
    expect(platformBrandName({ hasRestaurant: false, hostname: "localhost", siteUrl: undefined })).toBeUndefined();
  });
});
