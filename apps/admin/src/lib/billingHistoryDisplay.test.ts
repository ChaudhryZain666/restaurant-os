import { formatHistoryAmount, isMoneyReturnedToCustomer } from "./billingHistoryDisplay";

// Phase 89 — the amount text both billing pages (BillingPage, AgencyBillingPage) render per row.
describe("formatHistoryAmount", () => {
  const row = (type: Parameters<typeof formatHistoryAmount>[0]["type"], amountCents?: number, currency = "USD") => ({ type, amountCents, currency });

  it("shows refunds and chargebacks as negative amounts", () => {
    expect(formatHistoryAmount(row("refunded", 5900), "en-US")).toBe("-$59.00");
    expect(formatHistoryAmount(row("chargeback", 17900), "en-US")).toBe("-$179.00");
  });

  it("keeps payments, plan changes and chargeback reversals positive", () => {
    expect(formatHistoryAmount(row("payment_succeeded", 5900), "en-US")).toBe("$59.00");
    expect(formatHistoryAmount(row("plan_changed", 9900), "en-US")).toBe("$99.00");
    expect(formatHistoryAmount(row("chargeback_reversed", 5900), "en-US")).toBe("$59.00");
  });

  it("renders nothing for a row with no amount or currency", () => {
    expect(formatHistoryAmount(row("cancelled"), "en-US")).toBeNull();
    expect(formatHistoryAmount({ type: "refunded", amountCents: 5900, currency: undefined }, "en-US")).toBeNull();
  });

  it("only ever changes the displayed sign, never the stored value", () => {
    const stored = row("refunded", 5900);
    formatHistoryAmount(stored, "en-US");
    expect(stored.amountCents).toBe(5900);
    expect(isMoneyReturnedToCustomer("refunded")).toBe(true);
    expect(isMoneyReturnedToCustomer("payment_succeeded")).toBe(false);
  });
});
