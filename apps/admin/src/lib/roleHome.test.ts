import { describe, expect, it } from "@jest/globals";
import { restaurantSupportRedirect, roleHomePath } from "./roleHome";

describe("restaurant support redirect (QA-006)", () => {
  it("a platform admin with no location open goes to the platform support queue", () => {
    expect(restaurantSupportRedirect("platform_admin", null)).toBe("/platform/support");
    expect(restaurantSupportRedirect("platform_admin", null, "abc123")).toBe("/platform/support/tickets/abc123");
  });

  it("a platform admin running its own restaurant keeps the restaurant page", () => {
    expect(restaurantSupportRedirect("platform_admin", "rest-1")).toBeNull();
  });

  it("restaurant roles are never redirected", () => {
    for (const role of ["restaurant_owner", "restaurant_manager", "restaurant_staff", "kitchen_staff"] as const) {
      expect(restaurantSupportRedirect(role, "rest-1")).toBeNull();
    }
  });

  it("the role home mapping is unchanged", () => {
    expect(roleHomePath("platform_admin")).toBe("/platform");
    expect(roleHomePath("restaurant_owner")).toBe("/");
  });
});
