import { earlyTrialCheckout, immediateChargeAmount, subscribeNowLabel, trialCheckoutTarget } from "./trialCheckout";

/** Phase 89 — the owner page offers a trial's early checkout only with a valid target AND a price. */
describe("earlyTrialCheckout (BillingPage)", () => {
  const starter = {
    code: "owner_starter",
    pricing: [{ interval: "monthly" as const, amountCents: 5900, currency: "USD" }],
  };

  it("offers the trial's own plan and interval with the amount charged today", () => {
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "monthly" }, starter, "en-US")).toEqual({
      target: { planCode: "owner_starter", billingInterval: "monthly" },
      amount: "$59.00",
    });
  });

  it("offers nothing when the trial's interval has no configured price (no dead checkout action)", () => {
    // A yearly trial on a plan priced monthly only: the server would refuse the checkout.
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "yearly" }, starter, "en-US")).toBeNull();
    // A price entry without an amount or currency is not a configured price either.
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "monthly" }, { code: "owner_starter", pricing: [{ interval: "monthly", currency: "USD" }] }, "en-US")).toBeNull();
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "monthly" }, { code: "owner_starter", pricing: [] }, "en-US")).toBeNull();
  });

  it("offers nothing without a valid target (not trialing, provider-backed, or no plan)", () => {
    expect(earlyTrialCheckout({ status: "active", billingInterval: "monthly" }, starter, "en-US")).toBeNull();
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "monthly", providerSubscriptionId: "sub_1" }, starter, "en-US")).toBeNull();
    expect(earlyTrialCheckout({ status: "trialing", billingInterval: "monthly" }, null, "en-US")).toBeNull();
  });
});

/** Phase 89 — converting a trial early is an immediate charge, stated with the real amount. */
describe("immediate charge wording", () => {
  const starterPricing = [
    { interval: "monthly" as const, amountCents: 5900, currency: "USD" },
    { interval: "yearly" as const, amountCents: 59000, currency: "USD" },
  ];

  it("shows the trial plan's price for the trial's own interval", () => {
    expect(subscribeNowLabel(immediateChargeAmount(starterPricing, "monthly", "en-US"))).toBe("Subscribe now — $59.00 charged today");
    expect(subscribeNowLabel(immediateChargeAmount(starterPricing, "yearly", "en-US"))).toBe("Subscribe now — $590.00 charged today");
  });

  it("states an agency trial's own charge, monthly and yearly (AgencyBillingPage)", () => {
    const agencyPricing = [
      { interval: "monthly" as const, amountCents: 17900, currency: "USD" },
      { interval: "yearly" as const, amountCents: 179000, currency: "USD" },
    ];
    const monthlyTrial = trialCheckoutTarget({ status: "trialing", billingInterval: "monthly" }, "agency_growth_v2");
    const yearlyTrial = trialCheckoutTarget({ status: "trialing", billingInterval: "yearly" }, "agency_growth_v2");
    expect(monthlyTrial).toEqual({ planCode: "agency_growth_v2", billingInterval: "monthly" });
    // A yearly agency trial checks out yearly — never the page's hidden monthly default.
    expect(yearlyTrial).toEqual({ planCode: "agency_growth_v2", billingInterval: "yearly" });
    expect(subscribeNowLabel(immediateChargeAmount(agencyPricing, monthlyTrial!.billingInterval, "en-US"))).toBe(
      "Subscribe now — $179.00 charged today"
    );
    expect(subscribeNowLabel(immediateChargeAmount(agencyPricing, yearlyTrial!.billingInterval, "en-US"))).toBe(
      "Subscribe now — $1,790.00 charged today"
    );
  });

  it("still says it is billed today when the price for that interval isn't configured", () => {
    expect(immediateChargeAmount([starterPricing[0]], "yearly", "en-US")).toBeNull();
    expect(subscribeNowLabel(null)).toBe("Subscribe now — billed today");
  });
});

/** Phase 89 — a trial's checkout is for the trial's own plan and interval, never the picker default. */
describe("trialCheckoutTarget", () => {
  it("uses the trial's own plan and interval (a Starter monthly trial checks out Starter monthly)", () => {
    expect(trialCheckoutTarget({ status: "trialing", billingInterval: "monthly" }, "owner_starter")).toEqual({
      planCode: "owner_starter",
      billingInterval: "monthly",
    });
    expect(trialCheckoutTarget({ status: "trialing", billingInterval: "yearly" }, "owner_growth")).toEqual({
      planCode: "owner_growth",
      billingInterval: "yearly",
    });
  });

  it("offers nothing when the trial is already backed by a provider subscription", () => {
    expect(trialCheckoutTarget({ status: "trialing", billingInterval: "monthly", providerSubscriptionId: "sub_123" }, "owner_starter")).toBeNull();
  });

  it("offers nothing outside a trial, without a subscription, or without a known plan", () => {
    for (const status of ["active", "past_due", "cancelling", "cancelled", "expired"] as const) {
      expect(trialCheckoutTarget({ status, billingInterval: "monthly" }, "owner_starter")).toBeNull();
    }
    expect(trialCheckoutTarget(null, "owner_starter")).toBeNull();
    expect(trialCheckoutTarget({ status: "trialing", billingInterval: "monthly" }, undefined)).toBeNull();
  });
});
