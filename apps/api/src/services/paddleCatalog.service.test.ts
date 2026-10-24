import { describe, expect, it } from "@jest/globals";
import { buildPaddleCatalog, parseCatalogScriptArgs, type CatalogPlan, type NewPrice, type NewProduct, type PaddleCatalogApi, type PaddleCatalogProduct } from "./paddleCatalog.service.js";

// The launch catalog (planCatalogSeed.service.ts), which the Live Paddle catalog must mirror.
const PLANS: CatalogPlan[] = [
  { code: "owner_starter", name: "Owner — Starter", description: "Core online ordering.", isActive: true, pricing: [{ interval: "monthly", amountCents: 5900, currency: "USD" }, { interval: "yearly", amountCents: 59000, currency: "USD" }] },
  { code: "owner_growth", name: "Owner — Growth", isActive: true, pricing: [{ interval: "monthly", amountCents: 9900, currency: "USD" }, { interval: "yearly", amountCents: 99000, currency: "USD" }] },
  { code: "agency_growth_v2", name: "Agency — Growth", isActive: true, pricing: [{ interval: "monthly", amountCents: 17900, currency: "USD" }, { interval: "yearly", amountCents: 179000, currency: "USD" }] },
  { code: "owner_basic", name: "Owner — Basic (retired)", isActive: false, pricing: [{ interval: "monthly", amountCents: 2900, currency: "USD" }] },
];
const CODES = ["owner_starter", "owner_growth", "agency_growth_v2"];

let n = 0;
const id = (prefix: string) => `${prefix}_01testtesttesttesttest${String(n++).padStart(4, "0")}`;

function fakeApi(existing: PaddleCatalogProduct[] = []) {
  const created = { products: [] as NewProduct[], prices: [] as NewPrice[] };
  const api: PaddleCatalogApi = {
    listProducts: async () => existing,
    createProduct: async (body) => {
      created.products.push(body);
      return { id: id("pro") };
    },
    createPrice: async (body) => {
      created.prices.push(body);
      return { id: id("pri") };
    },
  };
  return { api, created };
}

const livePrice = (productId: string, interval: "monthly" | "yearly", amount: string, extra: Record<string, unknown> = {}) => ({
  id: id("pri"),
  product_id: productId,
  status: "active",
  unit_price: { amount, currency_code: "USD" },
  billing_cycle: { interval: interval === "monthly" ? "month" : "year", frequency: 1 },
  trial_period: null,
  custom_data: { internalPlanCode: "owner_starter", interval },
  ...extra,
});

describe("buildPaddleCatalog", () => {
  it("dry run on an empty Live account: plans every product and price, creates nothing", async () => {
    const { api, created } = fakeApi();
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: CODES, api, apply: false });
    expect(result.problems).toEqual([]);
    expect(result.applied).toBe(false);
    expect(result.mapping).toEqual({});
    expect(created.products).toHaveLength(0);
    expect(created.prices).toHaveLength(0);
    expect(result.plans.map((p) => [p.planCode, p.product.action, p.prices.map((pr) => `${pr.interval}:${pr.action}:${pr.amountCents}`)])).toEqual([
      ["owner_starter", "create", ["monthly:create:5900", "yearly:create:59000"]],
      ["owner_growth", "create", ["monthly:create:9900", "yearly:create:99000"]],
      ["agency_growth_v2", "create", ["monthly:create:17900", "yearly:create:179000"]],
    ]);
  });

  it("--apply creates exactly 3 products and 6 prices — SaaS, USD, 1-month/1-year cycles, no Paddle trial — and returns the mapping", async () => {
    const { api, created } = fakeApi();
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: CODES, api, apply: true });
    expect(result.applied).toBe(true);
    expect(created.products).toEqual([
      { name: "Owner — Starter", description: "Core online ordering.", tax_category: "saas", custom_data: { internalPlanCode: "owner_starter" } },
      { name: "Owner — Growth", tax_category: "saas", custom_data: { internalPlanCode: "owner_growth" } },
      { name: "Agency — Growth", tax_category: "saas", custom_data: { internalPlanCode: "agency_growth_v2" } },
    ]);
    expect(created.prices.map((p) => [p.custom_data.internalPlanCode, p.name, p.unit_price.amount, p.unit_price.currency_code, `${p.billing_cycle.frequency} ${p.billing_cycle.interval}`])).toEqual([
      ["owner_starter", "Monthly", "5900", "USD", "1 month"],
      ["owner_starter", "Annual", "59000", "USD", "1 year"],
      ["owner_growth", "Monthly", "9900", "USD", "1 month"],
      ["owner_growth", "Annual", "99000", "USD", "1 year"],
      ["agency_growth_v2", "Monthly", "17900", "USD", "1 month"],
      ["agency_growth_v2", "Annual", "179000", "USD", "1 year"],
    ]);
    expect(created.prices.every((p) => !("trial_period" in p))).toBe(true);
    for (const code of CODES) expect(result.mapping[code]).toEqual({ productId: expect.stringMatching(/^pro_/), monthly: expect.stringMatching(/^pri_/), yearly: expect.stringMatching(/^pri_/) });
  });

  it("re-running reuses everything that exists — no duplicates — and still returns the full mapping", async () => {
    const starter = { id: id("pro"), name: "Owner — Starter", status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_starter" }, prices: [] as ReturnType<typeof livePrice>[] };
    starter.prices = [livePrice(starter.id, "monthly", "5900"), livePrice(starter.id, "yearly", "59000")];
    const { api, created } = fakeApi([starter]);
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: ["owner_starter"], api, apply: true });
    expect(result.problems).toEqual([]);
    expect(created.products).toHaveLength(0);
    expect(created.prices).toHaveLength(0);
    expect(result.mapping.owner_starter).toEqual({ productId: starter.id, monthly: starter.prices[0].id, yearly: starter.prices[1].id });
  });

  it("an existing product missing one price gets only that price", async () => {
    const starter = { id: id("pro"), status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_starter" }, prices: [] as ReturnType<typeof livePrice>[] };
    starter.prices = [livePrice(starter.id, "monthly", "5900")];
    const { api, created } = fakeApi([starter]);
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: ["owner_starter"], api, apply: true });
    expect(created.products).toHaveLength(0);
    expect(created.prices.map((p) => [p.product_id, p.unit_price.amount])).toEqual([[starter.id, "59000"]]);
    expect(result.mapping.owner_starter.monthly).toBe(starter.prices[0].id);
  });

  it("refuses (creates nothing at all) when an existing price is wrong — amount, Paddle trial — never 'fixes' it", async () => {
    const starter = { id: id("pro"), status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_starter" }, prices: [] as ReturnType<typeof livePrice>[] };
    starter.prices = [livePrice(starter.id, "monthly", "4900"), livePrice(starter.id, "yearly", "59000", { trial_period: { interval: "day", frequency: 14 } })];
    const { api, created } = fakeApi([starter]);
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: CODES, api, apply: true });
    expect(result.applied).toBe(false);
    expect(created.products).toHaveLength(0);
    expect(created.prices).toHaveLength(0);
    expect(result.problems.join("\n")).toMatch(/owner_starter monthly: Paddle charges 4900 but the plan says 5900/);
    expect(result.problems.join("\n")).toMatch(/owner_starter yearly: the Paddle price has its own trial/);
  });

  it("refuses duplicates: two products for one plan, or two prices for one interval", async () => {
    const a = { id: id("pro"), status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_growth" }, prices: [] };
    const b = { id: id("pro"), status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_growth" }, prices: [] };
    const s = { id: id("pro"), status: "active", tax_category: "saas", custom_data: { internalPlanCode: "owner_starter" }, prices: [] as ReturnType<typeof livePrice>[] };
    s.prices = [livePrice(s.id, "monthly", "5900"), livePrice(s.id, "monthly", "5900")];
    const { api, created } = fakeApi([a, b, s]);
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: CODES, api, apply: true });
    expect(result.problems.join("\n")).toMatch(/owner_growth: 2 active Paddle products claim this plan/);
    expect(result.problems.join("\n")).toMatch(/owner_starter monthly: 2 active Paddle prices match/);
    expect(created.products).toHaveLength(0);
    expect(created.prices).toHaveLength(0);
  });

  it("refuses unknown or retired plans, and a non-SaaS product", async () => {
    const odd = { id: id("pro"), status: "active", tax_category: "standard", custom_data: { internalPlanCode: "owner_growth" }, prices: [] };
    const { api } = fakeApi([odd]);
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: ["owner_growth", "owner_basic", "nope"], api, apply: true });
    expect(result.problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/owner_growth: Paddle product .* tax category "standard"/),
        "owner_basic: plan is retired (isActive: false).",
        "nope: no such plan.",
      ])
    );
    expect(result.applied).toBe(false);
  });

  it("requires plans to be named", async () => {
    const result = await buildPaddleCatalog({ plans: PLANS, planCodes: [], api: fakeApi().api, apply: true });
    expect(result.problems[0]).toMatch(/No plans named/);
  });
});

describe("parseCatalogScriptArgs", () => {
  const live = { paddleEnv: "production" as const, hasApiKey: true };
  it("parses plans/out/apply", () => {
    expect(parseCatalogScriptArgs(["--plans", "owner_starter, owner_growth", "--out", "/tmp/m.json", "--apply"], live)).toEqual({
      planCodes: ["owner_starter", "owner_growth"],
      out: "/tmp/m.json",
      apply: true,
    });
  });
  it("is a dry run by default", () => {
    expect(parseCatalogScriptArgs(["--plans", "owner_starter", "--out", "m.json"], live).apply).toBe(false);
  });
  it("refuses sandbox unless --allow-sandbox, a missing key, unknown flags and missing values", () => {
    expect(() => parseCatalogScriptArgs(["--plans", "a", "--out", "m.json"], { paddleEnv: "sandbox", hasApiKey: true })).toThrow(/--allow-sandbox/);
    expect(parseCatalogScriptArgs(["--plans", "a", "--out", "m.json", "--allow-sandbox"], { paddleEnv: "sandbox", hasApiKey: true }).planCodes).toEqual(["a"]);
    expect(() => parseCatalogScriptArgs(["--plans", "a", "--out", "m.json"], { paddleEnv: "production", hasApiKey: false })).toThrow(/PADDLE_API_KEY/);
    expect(() => parseCatalogScriptArgs(["--plans", "a", "--out", "m.json", "--force"], live)).toThrow(/Unknown argument --force/);
    expect(() => parseCatalogScriptArgs(["--plans", "--out", "m.json"], live)).toThrow(/Usage/);
  });
});
