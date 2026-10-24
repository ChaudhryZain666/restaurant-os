import { checkPaddlePrice, type PaddlePrice, type PaddlePriceMapping } from "./paddlePriceMapping.service.js";

/**
 * Pre-launch — builds the Paddle product/price catalog for a Paddle environment (Live has none:
 * sandbox and live are separate data spaces) from the local Plan catalog, then hands its ids to
 * scripts/setPaddlePriceIds.ts, which re-checks every one before writing it to the Plan documents.
 *
 * Idempotent and conservative:
 *  - a plan's product is found by `custom_data.internalPlanCode` (the same key the sandbox catalog
 *    uses), its prices by `custom_data.interval`; anything already there is REUSED, never recreated;
 *  - an existing object that doesn't match the plan (amount, currency, cycle, Paddle trial, two
 *    products/prices for one plan interval) is reported and NOTHING is created — it is never "fixed"
 *    or archived automatically, since a live price may already have subscribers;
 *  - only the plans named on the command line are considered, and only if active with an amount.
 * Prices carry no Paddle trial: the 14-day trial is GarnishTable's own (subscription.service.ts).
 */

export interface CatalogPlan {
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  pricing: Array<{ interval: "monthly" | "yearly"; amountCents?: number | null; currency?: string | null }>;
}

export interface PaddleCatalogProduct {
  id: string;
  name?: string;
  status?: string;
  tax_category?: string;
  custom_data?: Record<string, unknown> | null;
  prices?: Array<PaddlePrice & { custom_data?: Record<string, unknown> | null }>;
}

export interface NewProduct {
  name: string;
  description?: string;
  tax_category: "saas";
  custom_data: { internalPlanCode: string };
}

export interface NewPrice {
  description: string;
  name: string;
  product_id: string;
  unit_price: { amount: string; currency_code: string };
  billing_cycle: { interval: "month" | "year"; frequency: 1 };
  tax_mode: "account_setting";
  custom_data: { internalPlanCode: string; interval: "monthly" | "yearly" };
}

export interface PaddleCatalogApi {
  /** Every ACTIVE product, with its active prices. */
  listProducts(): Promise<PaddleCatalogProduct[]>;
  createProduct(body: NewProduct): Promise<{ id: string }>;
  createPrice(body: NewPrice): Promise<{ id: string }>;
}

export interface CatalogPlanResult {
  planCode: string;
  product: { id?: string; action: "reuse" | "create" };
  prices: Array<{ interval: "monthly" | "yearly"; id?: string; action: "reuse" | "create"; amountCents: number; currency: string }>;
}

export interface CatalogResult {
  problems: string[];
  plans: CatalogPlanResult[];
  /** Complete only when applied (or when everything already existed). */
  mapping: PaddlePriceMapping;
  applied: boolean;
}

const INTERVAL_LABEL = { monthly: "Monthly", yearly: "Annual" } as const;
const PADDLE_INTERVAL = { monthly: "month", yearly: "year" } as const;

/** Paddle's custom_data is free-form; only our own keys are read. */
const dataOf = (o: { custom_data?: Record<string, unknown> | null }) => o.custom_data ?? {};

export async function buildPaddleCatalog(options: {
  plans: CatalogPlan[];
  planCodes: string[];
  api: PaddleCatalogApi;
  apply: boolean;
}): Promise<CatalogResult> {
  const result: CatalogResult = { problems: [], plans: [], mapping: {}, applied: false };
  if (!options.planCodes.length) {
    result.problems.push("No plans named — pass --plans owner_starter,owner_growth,agency_growth_v2 (the codes to sell through Paddle).");
    return result;
  }
  const products = await options.api.listProducts();

  for (const code of options.planCodes) {
    const plan = options.plans.find((p) => p.code === code);
    if (!plan) {
      result.problems.push(`${code}: no such plan.`);
      continue;
    }
    if (!plan.isActive) {
      result.problems.push(`${code}: plan is retired (isActive: false).`);
      continue;
    }
    const matches = products.filter((p) => dataOf(p).internalPlanCode === code);
    if (matches.length > 1) {
      result.problems.push(`${code}: ${matches.length} active Paddle products claim this plan (${matches.map((p) => p.id).join(", ")}) — archive the extra one in the dashboard first.`);
      continue;
    }
    const product = matches[0];
    if (product && product.tax_category !== "saas") result.problems.push(`${code}: Paddle product ${product.id} has tax category "${product.tax_category}", not "saas".`);
    const planResult: CatalogPlanResult = { planCode: code, product: product ? { id: product.id, action: "reuse" } : { action: "create" }, prices: [] };

    for (const pricing of plan.pricing) {
      const label = `${code} ${pricing.interval}`;
      if (pricing.amountCents == null || !pricing.currency) {
        result.problems.push(`${label}: the plan has no amount/currency.`);
        continue;
      }
      const existing = (product?.prices ?? []).filter(
        (pr) => pr.status === "active" && (dataOf(pr).interval === pricing.interval || pr.billing_cycle?.interval === PADDLE_INTERVAL[pricing.interval])
      );
      if (existing.length > 1) {
        result.problems.push(`${label}: ${existing.length} active Paddle prices match (${existing.map((p) => p.id).join(", ")}) — archive the extra one first.`);
        continue;
      }
      if (existing[0]) {
        result.problems.push(
          ...checkPaddlePrice(existing[0], {
            priceId: existing[0].id!,
            productId: product!.id,
            interval: pricing.interval,
            amountCents: pricing.amountCents,
            currency: pricing.currency,
            label,
          })
        );
        planResult.prices.push({ interval: pricing.interval, id: existing[0].id, action: "reuse", amountCents: pricing.amountCents, currency: pricing.currency });
      } else {
        planResult.prices.push({ interval: pricing.interval, action: "create", amountCents: pricing.amountCents, currency: pricing.currency });
      }
    }
    result.plans.push(planResult);
  }

  const nothingToCreate = result.plans.every((p) => p.product.action === "reuse" && p.prices.every((pr) => pr.action === "reuse"));
  if (result.problems.length) return result;
  if (!options.apply && !nothingToCreate) return result;

  for (const planResult of result.plans) {
    const plan = options.plans.find((p) => p.code === planResult.planCode)!;
    if (planResult.product.action === "create") {
      planResult.product.id = (
        await options.api.createProduct({
          name: plan.name,
          ...(plan.description ? { description: plan.description } : {}),
          tax_category: "saas",
          custom_data: { internalPlanCode: plan.code },
        })
      ).id;
    }
    for (const price of planResult.prices) {
      if (price.action !== "create") continue;
      price.id = (
        await options.api.createPrice({
          description: `${plan.name} — ${INTERVAL_LABEL[price.interval]}`,
          name: INTERVAL_LABEL[price.interval],
          product_id: planResult.product.id!,
          unit_price: { amount: String(price.amountCents), currency_code: price.currency.toUpperCase() },
          billing_cycle: { interval: PADDLE_INTERVAL[price.interval], frequency: 1 },
          tax_mode: "account_setting",
          custom_data: { internalPlanCode: plan.code, interval: price.interval },
        })
      ).id;
    }
    result.mapping[plan.code] = {
      productId: planResult.product.id!,
      ...Object.fromEntries(planResult.prices.map((p) => [p.interval, p.id!])),
    };
  }
  result.applied = options.apply && !nothingToCreate;
  return result;
}

/** scripts/createPaddleCatalog.ts's command line. Never echoes the API key. */
export function parseCatalogScriptArgs(
  args: string[],
  context: { paddleEnv: "sandbox" | "production"; hasApiKey: boolean }
): { planCodes: string[]; out: string; apply: boolean } {
  const usage = "Usage: createPaddleCatalog --plans <code,code,…> --out <mapping.json> [--apply] [--allow-sandbox]";
  const value = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
  };
  const known = new Set(["--plans", "--out", "--apply", "--allow-sandbox"]);
  const values = new Set([value("--plans"), value("--out")].filter(Boolean));
  const unknown = args.filter((a) => !known.has(a) && !values.has(a));
  if (unknown.length) throw new Error(`Unknown argument ${unknown.join(", ")}. ${usage}`);
  const plans = value("--plans");
  const out = value("--out");
  if (!plans || !out) throw new Error(usage);
  if (!context.hasApiKey) throw new Error("PADDLE_API_KEY is not set.");
  if (context.paddleEnv !== "production" && !args.includes("--allow-sandbox")) {
    throw new Error(`PADDLE_ENV is "${context.paddleEnv}". The live catalog is created against production; pass --allow-sandbox only to rehearse.`);
  }
  return { planCodes: [...new Set(plans.split(",").map((c) => c.trim()).filter(Boolean))], out, apply: args.includes("--apply") };
}
