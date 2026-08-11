import { describe, expect, it } from "@jest/globals";
import { computeAvailability } from "./restaurantAvailability.service.js";

describe("computeAvailability", () => {
  it("is closed when orderingEnabled is false, regardless of the pause flag", () => {
    expect(computeAvailability({ orderingEnabled: false, temporarilyPaused: false })).toEqual({ status: "closed" });
    expect(computeAvailability({ orderingEnabled: false, temporarilyPaused: true })).toEqual({ status: "closed" });
  });

  it("is paused when orderingEnabled is true but temporarilyPaused is set", () => {
    expect(computeAvailability({ orderingEnabled: true, temporarilyPaused: true, pausedReason: "Back in 20" })).toEqual({
      status: "paused",
      reason: "Back in 20",
    });
  });

  it("is paused with no reason when pausedReason is absent", () => {
    expect(computeAvailability({ orderingEnabled: true, temporarilyPaused: true })).toEqual({ status: "paused" });
  });

  it("is open otherwise", () => {
    expect(computeAvailability({ orderingEnabled: true, temporarilyPaused: false })).toEqual({ status: "open" });
  });
});
