import { canSwitchToOwnStaff } from "./deliveryActions";

// Phase 89 — when the order panel offers "Deliver with your own staff" (DeliveryStatusPanel).
describe("canSwitchToOwnStaff", () => {
  it("is offered for a failed courier booking with no courier booked", () => {
    expect(canSwitchToOwnStaff({ provider: "uber_direct", status: "failed" })).toBe(true);
  });

  it("is not offered once a courier is booked, for a delivery that hasn't failed, or for own-staff deliveries", () => {
    expect(canSwitchToOwnStaff({ provider: "uber_direct", status: "failed", providerDeliveryId: "del_1" })).toBe(false);
    expect(canSwitchToOwnStaff({ provider: "uber_direct", status: "requested" })).toBe(false);
    expect(canSwitchToOwnStaff({ provider: "uber_direct", status: "pending" })).toBe(false);
    expect(canSwitchToOwnStaff({ provider: "manual", status: "failed" })).toBe(false);
  });
});
