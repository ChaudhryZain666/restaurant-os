import { formatHistoryAmount, isMoneyReturnedToCustomer } from "./billingHistoryDisplay";

// Phase 89 — the amount text both billing pages (BillingPage, AgencyBillingPage) render per row.
describe("formatHistoryAmount", () => {
  const row = (type: Parameters<typeof formatHistoryAmount>[0]["type"], amountCents?: number, currency = "USD") => ({ type, amountCents, currency });

  it("shows refunds and chargebacks as negative amounts", () => {
    expect(formatHistoryAmount(row("refunded", 5900), "en-US")).toBe("-$59.00");
    expect(formatHistoryAmount(row("chargeback", 17900), "en-US")).toBe("-$179.00");
  });

  it("keeps payments and chargeback reversals positive", () => {
    expect(formatHistoryAmount(row("payment_succeeded", 5900), "en-US")).toBe("$59.00");
    expect(formatHistoryAmount(row("chargeback_reversed", 5900), "en-US")).toBe("$59.00");
  });

  it("never shows a plan change's stored plan price as if it were charged (Phase 89)", () => {
    // Starter → Growth stores Growth's $99 list price; nothing is charged at the change (prorated
    // onto the next renewal), so the row shows no amount.
    expect(formatHistoryAmount(row("plan_changed", 9900), "en-US")).toBeNull();
    expect(formatHistoryAmount(row("plan_changed", 5900), "en-US")).toBeNull();
    // ...while a real payment and an adjustment still show their actual amounts.
    expect(formatHistoryAmount(row("payment_succeeded", 9900), "en-US")).toBe("$99.00");
    expect(formatHistoryAmount(row("refunded", 9900), "en-US")).toBe("-$99.00");
  });

  it("renders nothing for a row with no amount or currency", () => {
    expect(formatHistoryAmount(row("cancelled"), "en-US")).toBeNull();
    expect(formatHistoryAmount({ type: "refunded", amountCents: 5900, currency: undefined }, "en-US")).toBeNull();
  });

  it("never shows a charge for a trial or subscription starting (Phase 89)", () => {
    // A no-card trial: the new "trial_started" row, and a legacy "subscription_created" row that
    // stored the plan price although nothing was charged — neither may read as a $59 payment.
    expect(formatHistoryAmount(row("trial_started"), "en-US")).toBeNull();
    expect(formatHistoryAmount(row("trial_started", 5900), "en-US")).toBeNull();
    expect(formatHistoryAmount(row("subscription_created", 5900), "en-US")).toBeNull();
  });

  it("still shows the real amount of an actual payment (a checkout's payment_succeeded row)", () => {
    expect(formatHistoryAmount(row("payment_succeeded", 5900), "en-US")).toBe("$59.00");
    expect(formatHistoryAmount(row("payment_failed", 5900), "en-US")).toBe("$59.00");
  });

  it("only ever changes the displayed sign, never the stored value", () => {
    const stored = row("refunded", 5900);
    formatHistoryAmount(stored, "en-US");
    expect(stored.amountCents).toBe(5900);
    expect(isMoneyReturnedToCustomer("refunded")).toBe(true);
    expect(isMoneyReturnedToCustomer("payment_succeeded")).toBe(false);
  });
});
