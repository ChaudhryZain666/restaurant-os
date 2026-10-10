import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { connectDB } from "../config/db.js";
import { Plan } from "../models/Plan.js";
import { applyPaddlePriceMapping, checkPaddlePrice, parsePriceMapping, parsePriceScriptArgs, type PaddlePrice } from "./paddlePriceMapping.service.js";
import { closeTestConnections, createTestPlan } from "../test-utils/fixtures.js";

/** Phase 89 — P4: loading live Paddle price ids is checked against Paddle and all-or-nothing. */
const PRODUCT = "pro_01aaaaaaaaaaaa";
const MONTHLY = "pri_01monthlyaaaa";
const YEARLY = "pri_01yearlyaaaaa";

function paddlePrice(overrides: Partial<PaddlePrice> = {}, interval: "month" | "year" = "month", amount = "5900"): PaddlePrice {
  return {
    id: interval === "month" ? MONTHLY : YEARLY,
    product_id: PRODUCT,
    status: "active",
    unit_price: { amount, currency_code: "USD" },
    billing_cycle: { interval, frequency: 1 },
    trial_period: null,
    ...overrides,
  };
}

const expected = { priceId: MONTHLY, productId: PRODUCT, interval: "monthly" as const, amountCents: 5900, currency: "USD", label: "plan monthly" };

describe("parsePriceMapping", () => {
  it("accepts well-formed ids", () => {
    const { problems, mapping } = parsePriceMapping({ owner_starter: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } });
    expect(problems).toEqual([]);
    expect(mapping.owner_starter).toEqual({ productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY });
  });

  it("refuses mock ids, malformed ids, empty mappings and a price id used twice", () => {
    expect(parsePriceMapping({ owner_starter: { productId: PRODUCT, monthly: "mock_price_owner_starter_monthly" } }).problems.join()).toMatch(/not a Paddle price id/);
    expect(parsePriceMapping({ owner_starter: { productId: "prod_x", monthly: MONTHLY } }).problems.join()).toMatch(/not a Paddle product id/);
    expect(parsePriceMapping({}).problems.join()).toMatch(/empty/);
    expect(parsePriceMapping([]).problems.join()).toMatch(/JSON object/);
    expect(parsePriceMapping({ a: { productId: PRODUCT, monthly: MONTHLY }, b: { productId: PRODUCT, monthly: MONTHLY } }).problems.join()).toMatch(/more than once/);
  });
});

describe("checkPaddlePrice", () => {
  it("passes a price that matches exactly", () => {
    expect(checkPaddlePrice(paddlePrice(), expected)).toEqual([]);
  });

  it("flags every mismatch", () => {
    expect(checkPaddlePrice(null, expected).join()).toMatch(/not found in this Paddle environment/);
    expect(checkPaddlePrice(paddlePrice({ status: "archived" }), expected).join()).toMatch(/not active/);
    expect(checkPaddlePrice(paddlePrice({ product_id: "pro_other" }), expected).join()).toMatch(/belongs to product/);
    expect(checkPaddlePrice(paddlePrice({}, "month", "6900"), expected).join()).toMatch(/charges 6900/);
    expect(checkPaddlePrice(paddlePrice({ unit_price: { amount: "5900", currency_code: "EUR" } }), expected).join()).toMatch(/currency EUR/);
    expect(checkPaddlePrice(paddlePrice({}, "year"), expected).join()).toMatch(/not every 1 month/);
    expect(checkPaddlePrice(paddlePrice({ billing_cycle: null }), expected).join()).toMatch(/one-time/);
    expect(checkPaddlePrice(paddlePrice({ billing_cycle: { interval: "month", frequency: 3 } }), expected).join()).toMatch(/every 3 month/);
    expect(checkPaddlePrice(paddlePrice({ trial_period: { interval: "day", frequency: 14 } }), expected).join()).toMatch(/own trial/);
  });
});

describe("applyPaddlePriceMapping", () => {
  let plan: Awaited<ReturnType<typeof createTestPlan>>;
  const prices: Record<string, PaddlePrice> = {
    [MONTHLY]: paddlePrice(),
    [YEARLY]: paddlePrice({}, "year", "59000"),
  };
  const fetchPrice = async (id: string) => prices[id] ?? null;

  beforeAll(async () => {
    await connectDB();
    plan = await createTestPlan({
      pricing: [
        { interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: "mock_price_m" },
        { interval: "yearly", amountCents: 59000, currency: "USD", providerPriceId: "mock_price_y" },
      ],
    });
  });

  afterAll(async () => {
    await Plan.deleteOne({ _id: plan._id });
    await closeTestConnections();
  });

  it("a dry run reports the changes and writes nothing", async () => {
    const result = await applyPaddlePriceMapping({ mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } }, fetchPrice, apply: false });
    expect(result.problems).toEqual([]);
    expect(result.applied).toBe(false);
    expect(result.priceChanges).toHaveLength(2);
    const stored = await Plan.findById(plan._id).lean();
    expect(stored!.pricing.map((p) => p.providerPriceId)).toEqual(["mock_price_m", "mock_price_y"]);
    expect(stored!.providerProductId).toBeUndefined();
  });

  it("any mismatch writes nothing, even for the prices that were fine", async () => {
    const result = await applyPaddlePriceMapping({
      mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } },
      fetchPrice: async (id) => (id === YEARLY ? paddlePrice({}, "year", "49000") : fetchPrice(id)),
      apply: true,
    });
    expect(result.applied).toBe(false);
    expect(result.problems.join()).toMatch(/charges 49000/);
    expect((await Plan.findById(plan._id).lean())!.pricing[0].providerPriceId).toBe("mock_price_m");
  });

  it("refuses a missing interval, an unknown plan, and a retired plan", async () => {
    const missing = await applyPaddlePriceMapping({ mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY } }, fetchPrice, apply: true });
    expect(missing.problems.join()).toMatch(/yearly: the plan sells this interval but no price id was given/);
    const unknown = await applyPaddlePriceMapping({ mapping: { no_such_plan: { productId: PRODUCT, monthly: MONTHLY } }, fetchPrice, apply: true });
    expect(unknown.problems.join()).toMatch(/no such plan/);
    const retired = await createTestPlan({ isActive: false, pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD" }] });
    try {
      const r = await applyPaddlePriceMapping({ mapping: { [retired.code]: { productId: PRODUCT, monthly: MONTHLY } }, fetchPrice, apply: true });
      expect(r.problems.join()).toMatch(/retired/);
    } finally {
      await Plan.deleteOne({ _id: retired._id });
    }
  });

  it("refuses a price id another plan already uses", async () => {
    const other = await createTestPlan({ pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD", providerPriceId: MONTHLY }] });
    try {
      const r = await applyPaddlePriceMapping({ mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } }, fetchPrice, apply: true });
      expect(r.applied).toBe(false);
      expect(r.problems.join()).toMatch(new RegExp(`${other.code}: already uses`));
    } finally {
      await Plan.deleteOne({ _id: other._id });
    }
  });

  it("with --apply and every check passing, writes exactly the product and price ids", async () => {
    const result = await applyPaddlePriceMapping({ mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } }, fetchPrice, apply: true });
    expect(result.problems).toEqual([]);
    expect(result.applied).toBe(true);
    const stored = await Plan.findById(plan._id).lean();
    expect(stored!.providerProductId).toBe(PRODUCT);
    expect(stored!.pricing.map((p) => [p.interval, p.providerPriceId, p.amountCents])).toEqual([
      ["monthly", MONTHLY, 5900],
      ["yearly", YEARLY, 59000],
    ]);
    // Re-running is a no-op.
    const again = await applyPaddlePriceMapping({ mapping: { [plan.code]: { productId: PRODUCT, monthly: MONTHLY, yearly: YEARLY } }, fetchPrice, apply: true });
    expect(again.priceChanges).toEqual([]);
    expect(again.productChanges).toEqual([]);
  });
});


describe("parsePriceScriptArgs (the setPaddlePriceIds command line)", () => {
  const live = { paddleEnv: "production" as const, hasApiKey: true };

  it("defaults to a dry run and only writes with --apply", () => {
    expect(parsePriceScriptArgs(["--file", "prices.json"], live)).toEqual({ file: "prices.json", apply: false });
    expect(parsePriceScriptArgs(["--apply", "--file", "prices.json"], live)).toEqual({ file: "prices.json", apply: true });
  });

  it("requires a mapping file and an API key, and rejects unknown options", () => {
    expect(() => parsePriceScriptArgs([], live)).toThrow(/Usage/);
    expect(() => parsePriceScriptArgs(["--file"], live)).toThrow(/Usage/);
    expect(() => parsePriceScriptArgs(["--file", "--apply"], live)).toThrow(/Usage/);
    expect(() => parsePriceScriptArgs(["--file", "p.json", "--force"], live)).toThrow(/Unknown option --force/);
    expect(() => parsePriceScriptArgs(["--file", "p.json"], { ...live, hasApiKey: false })).toThrow(/PADDLE_API_KEY is not set/);
  });

  it("refuses a sandbox environment unless explicitly rehearsing", () => {
    expect(() => parsePriceScriptArgs(["--file", "p.json"], { paddleEnv: "sandbox", hasApiKey: true })).toThrow(/must be checked against production/);
    expect(parsePriceScriptArgs(["--file", "p.json", "--allow-sandbox"], { paddleEnv: "sandbox", hasApiKey: true })).toEqual({ file: "p.json", apply: false });
  });
});
