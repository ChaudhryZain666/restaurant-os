import { describe, expect, it } from "@jest/globals";
import { checkLemonSqueezyVariant, parseVariantMapping } from "./lemonSqueezyVariantMapping.service.js";

const expected = { variantId: "2346454", productId: "1506851", interval: "monthly" as const, amountCents: 5900, testMode: true, label: "owner_starter monthly" };
const good = { id: "2346454", product_id: 1506851, status: "published", price: 5900, is_subscription: true, interval: "month" as const, interval_count: 1, has_free_trial: false, test_mode: true };

describe("parseVariantMapping", () => {
  it("accepts the committed test-mode mapping shape", () => {
    const { mapping, problems } = parseVariantMapping({
      owner_starter: { productId: "1506851", monthly: "2346454", yearly: "2346457" },
      agency_growth_v2: { productId: "1506869", monthly: "2346481", yearly: "2346489" },
    });
    expect(problems).toEqual([]);
    expect(mapping.owner_starter).toEqual({ productId: "1506851", monthly: "2346454", yearly: "2346457" });
  });

  it("rejects non-numeric ids, empty entries and a variant used twice", () => {
    const { problems } = parseVariantMapping({
      a: { productId: "pro_x", monthly: "pri_y" },
      b: { productId: "1" },
      c: { productId: "2", monthly: "9", yearly: "9" },
    });
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('productId "pro_x"'),
        expect.stringContaining('monthly "pri_y"'),
        "b: no monthly or yearly variant id given.",
        "The same variant id is used more than once: 9.",
      ])
    );
  });
});

describe("checkLemonSqueezyVariant", () => {
  it("passes a published monthly subscription variant at exactly the plan's price", () => {
    expect(checkLemonSqueezyVariant(good, expected)).toEqual([]);
  });

  it("flags every mismatch that would bill the wrong amount, interval, product or mode", () => {
    const problems = checkLemonSqueezyVariant(
      { ...good, status: "draft", product_id: 1, price: 7900, interval: "year", has_free_trial: true, test_mode: false },
      expected
    );
    expect(problems).toHaveLength(6);
  });

  it("reports a variant this API key can't see", () => {
    expect(checkLemonSqueezyVariant(null, expected)[0]).toContain("was not found with this API key");
  });
});
