import { describe, expect, it } from "@jest/globals";
import { ApiClientError } from "@restaurant/utils";
import { ORDER_NOT_FOUND_MESSAGE, orderLoadErrorMessage } from "./orderLoadError";

// QA-007 — opening another customer's order showed a bare "Forbidden".
describe("order load errors (QA-007)", () => {
  it("someone else's order, a missing order and a malformed link all read the same", () => {
    const forbidden = orderLoadErrorMessage(new ApiClientError("Forbidden", "FORBIDDEN", 403));
    const missing = orderLoadErrorMessage(new ApiClientError("Order not found", "NOT_FOUND", 404));
    const malformed = orderLoadErrorMessage(new ApiClientError("Invalid id", "BAD_REQUEST", 400));
    expect(forbidden).toBe(ORDER_NOT_FOUND_MESSAGE);
    expect(missing).toBe(forbidden);
    expect(malformed).toBe(forbidden);
    expect(forbidden).not.toMatch(/forbidden|another customer|belongs/i);
  });

  it("a signed-out visitor is asked to sign in", () => {
    expect(orderLoadErrorMessage(new ApiClientError("Missing access token", "UNAUTHORIZED", 401))).toBe("Sign in to see this order.");
  });

  it("server and network failures get a retry message, not internals", () => {
    expect(orderLoadErrorMessage(new ApiClientError("boom", "INTERNAL", 500))).toMatch(/try again/);
    expect(orderLoadErrorMessage(new TypeError("Failed to fetch"))).toMatch(/try again/);
  });
});
