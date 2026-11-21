import { describe, expect, it } from "@jest/globals";
import { updateRestaurantSchema } from "@restaurant/validation";
import { describeApiError } from "@restaurant/utils";
import { restaurantNameError, serverNameError } from "./restaurantName";

// QA-005 — a blank restaurant name used to come back as a bare "Validation failed".
describe("restaurant name validation (QA-005)", () => {
  it("blank and whitespace-only names are refused with a field message", () => {
    expect(restaurantNameError("")).toBe("Enter a restaurant name.");
    expect(restaurantNameError("    ")).toBe("Enter a restaurant name.");
    expect(restaurantNameError(" A ")).toMatch(/at least 2 characters/);
    expect(restaurantNameError("x".repeat(121))).toMatch(/120 characters/);
  });

  it("valid names pass, surrounding spaces ignored", () => {
    expect(restaurantNameError("Wildwood Kitchen")).toBeNull();
    expect(restaurantNameError("  Wildwood  ")).toBeNull();
  });

  it("the server still refuses a whitespace-only name, and the client agrees with it", () => {
    for (const name of ["", "   ", "A", "x".repeat(121), "Wildwood"]) {
      const server = updateRestaurantSchema.safeParse({ name });
      expect(server.success).toBe(restaurantNameError(name) === null);
    }
    expect(updateRestaurantSchema.parse({ name: "  Wildwood  " }).name).toBe("Wildwood");
  });

  it("the server's field message reaches the user instead of 'Validation failed'", () => {
    const result = updateRestaurantSchema.safeParse({ name: "   " });
    if (result.success) throw new Error("expected failure");
    const details = result.error.flatten().fieldErrors;
    expect(serverNameError(details)).toBe("Restaurant name must be at least 2 characters");
    expect(describeApiError("Validation failed", details)).toBe("Restaurant name must be at least 2 characters");
  });

  it("other errors are passed through unchanged", () => {
    expect(describeApiError("Forbidden", { name: ["x"] })).toBe("Forbidden");
    expect(describeApiError("Validation failed", undefined)).toBe("Validation failed");
    expect(describeApiError("Validation failed", { minOrderAmount: ["Expected number"] })).toBe("Min order amount: Expected number");
  });
});
