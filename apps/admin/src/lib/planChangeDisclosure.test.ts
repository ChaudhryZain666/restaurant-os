import { planChangeBillingNote, planChangeDirection } from "./planChangeDisclosure";

/** Phase 89 — the change-plan dialog states when the change is billed, matching the API's behaviour. */
describe("planChangeBillingNote", () => {
  const paddleSub = { status: "active", provider: "paddle", providerSubscriptionId: "sub_123" } as const;

  it("an upgrade: changes now, nothing charged today, the difference is added to the next bill", () => {
    expect(planChangeBillingNote(paddleSub, "Owner — Growth", "$99.00/mo", "11/13/2026", "upgrade")).toBe(
      "Your plan changes to Owner — Growth ($99.00/mo) now. Nothing is charged today: the prorated difference for the rest of this billing period is added to your next bill on 11/13/2026."
    );
  });

  it("a downgrade is a credit, never described as an added charge", () => {
    const note = planChangeBillingNote(paddleSub, "Owner — Starter", "$59.00/mo", "11/13/2026", "downgrade");
    expect(note).toBe(
      "Your plan changes to Owner — Starter ($59.00/mo) now. Nothing is charged today: the unused part of your current plan for the rest of this billing period is credited against your next bill on 11/13/2026."
    );
    expect(note).not.toMatch(/added/);
  });

  it("an unknown direction gets neutral wording (neither 'added' nor 'credited')", () => {
    const note = planChangeBillingNote(paddleSub, "Owner — Growth", "$99.00/mo", "11/13/2026");
    expect(note).toBe(
      "Your plan changes to Owner — Growth ($99.00/mo) now. Nothing is charged today: the prorated difference for the rest of this billing period shows on your next bill on 11/13/2026."
    );
  });

  it("direction comes from the two prices at the same interval", () => {
    expect(planChangeDirection(5900, 9900)).toBe("upgrade");
    expect(planChangeDirection(9900, 5900)).toBe("downgrade");
    expect(planChangeDirection(9900, 9900)).toBe("unknown");
    expect(planChangeDirection(undefined, 9900)).toBe("unknown");
  });

  it("never states a proration amount, and still reads correctly when the new price is unknown", () => {
    const note = planChangeBillingNote({ status: "active", provider: "paddle", providerSubscriptionId: "sub_123" }, "Owner — Growth", null, "11/13/2026", "upgrade");
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
