import { planChangeBillingNote } from "./planChangeDisclosure";

/** Phase 89 — the change-plan dialog states when the change is billed, matching the API's behaviour. */
describe("planChangeBillingNote", () => {
  it("a Paddle-backed subscription: changes now, nothing charged today, difference on the next bill", () => {
    expect(
      planChangeBillingNote({ status: "active", provider: "paddle", providerSubscriptionId: "sub_123" }, "Owner — Growth", "$99.00/mo", "11/13/2026")
    ).toBe(
      "Your plan changes to Owner — Growth ($99.00/mo) now. Nothing is charged today: the prorated difference for the rest of this billing period is added to your next bill on 11/13/2026."
    );
  });

  it("never states a proration amount, and still reads correctly when the new price is unknown", () => {
    const note = planChangeBillingNote({ status: "active", provider: "paddle", providerSubscriptionId: "sub_123" }, "Owner — Growth", null, "11/13/2026");
    expect(note).toBe(
      "Your plan changes to Owner — Growth now. Nothing is charged today: the prorated difference for the rest of this billing period is added to your next bill on 11/13/2026."
    );
    expect(note).not.toMatch(/\$\d/);
  });

  it("a no-card trial (no provider subscription): nothing is charged now", () => {
    expect(planChangeBillingNote({ status: "trialing", provider: "paddle" }, "Owner — Growth", "$99.00/mo", "10/28/2026")).toBe(
      "You're on a free trial, so nothing is charged now."
    );
  });

  it("makes no billing claim for other providers (mock/internal)", () => {
    expect(planChangeBillingNote({ status: "active", provider: "mock", providerSubscriptionId: "mock_sub_1" }, "Owner — Growth", "$99.00/mo", "11/13/2026")).toBeNull();
    expect(planChangeBillingNote({ status: "active", provider: "internal" }, "Owner — Growth", "$99.00/mo", "11/13/2026")).toBeNull();
  });
});
