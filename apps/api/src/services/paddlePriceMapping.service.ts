import { Plan } from "../models/Plan.js";

/**
 * Phase 89 — loads the real Paddle product/price ids into the Plan catalog, which the seed fills
 * with `mock_price_*` placeholders (planCatalogSeed.service.ts). Every id is checked against Paddle
 * itself before anything is written: the price must exist in the environment being configured,
 * belong to the named product, be active, recurring at exactly the plan's interval, charge exactly
 * the plan's amount and currency, and carry no Paddle-side trial (the 14-day trial is ours —
 * subscription.service.ts — a Paddle trial would stack a second one on top). Used by
 * scripts/setPaddlePriceIds.ts; nothing here creates or changes anything in Paddle.
 */

export interface PlanPriceIds {
  productId: string;
  monthly?: string;
  yearly?: string;
}

/** plan code → ids, exactly as the operator supplies them (ids are not secrets). */
export type PaddlePriceMapping = Record<string, PlanPriceIds>;

/** The fields of a Paddle price entity this check reads (Billing API `GET /prices/{id}`). */
export interface PaddlePrice {
  id?: string;
  product_id?: string;
  status?: string;
  unit_price?: { amount?: string; currency_code?: string };
  billing_cycle?: { interval?: string; frequency?: number } | null;
  trial_period?: unknown;
}

export interface PriceIdChange {
  planCode: string;
  interval: "monthly" | "yearly";
  from?: string;
  to: string;
}

export interface PriceMappingResult {
  problems: string[];
  priceChanges: PriceIdChange[];
  productChanges: Array<{ planCode: string; from?: string; to: string }>;
  applied: boolean;
}

const PRODUCT_ID = /^pro_[a-z0-9]{10,}$/;
const PRICE_ID = /^pri_[a-z0-9]{10,}$/;
const PADDLE_INTERVAL = { monthly: "month", yearly: "year" } as const;

/** Shape/format checks that need neither the database nor Paddle. */
export function parsePriceMapping(input: unknown): { mapping: PaddlePriceMapping; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { mapping: {}, problems: ["The mapping must be a JSON object of plan code → { productId, monthly, yearly }."] };
  }
  const mapping: PaddlePriceMapping = {};
  for (const [planCode, raw] of Object.entries(input as Record<string, unknown>)) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const ids: PlanPriceIds = { productId: String(entry.productId ?? "") };
    if (!PRODUCT_ID.test(ids.productId)) problems.push(`${planCode}: productId "${ids.productId}" is not a Paddle product id (pro_…).`);
    for (const interval of ["monthly", "yearly"] as const) {
      if (entry[interval] === undefined) continue;
      const id = String(entry[interval]);
      if (!PRICE_ID.test(id)) problems.push(`${planCode}: ${interval} "${id}" is not a Paddle price id (pri_…).`);
      ids[interval] = id;
    }
    if (!ids.monthly && !ids.yearly) problems.push(`${planCode}: no monthly or yearly price id given.`);
    mapping[planCode] = ids;
  }
  if (!Object.keys(mapping).length) problems.push("The mapping is empty.");
  const all = Object.values(mapping).flatMap((ids) => [ids.monthly, ids.yearly].filter(Boolean) as string[]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  if (dupes.length) problems.push(`The same price id is used more than once: ${[...new Set(dupes)].join(", ")}.`);
  return { mapping, problems };
}

/** Everything wrong with one Paddle price for the plan price it is meant to represent. */
export function checkPaddlePrice(
  price: PaddlePrice | null,
  expected: { priceId: string; productId: string; interval: "monthly" | "yearly"; amountCents: number; currency: string; label: string }
): string[] {
  const { label } = expected;
  if (!price) return [`${label}: ${expected.priceId} was not found in this Paddle environment (a sandbox id used against live, or a typo).`];
  const problems: string[] = [];
  if (price.status !== "active") problems.push(`${label}: price is "${price.status}", not active.`);
  if (price.product_id !== expected.productId) problems.push(`${label}: price belongs to product ${price.product_id}, not ${expected.productId}.`);
  if (price.unit_price?.amount !== String(expected.amountCents)) {
    problems.push(`${label}: Paddle charges ${price.unit_price?.amount ?? "?"} but the plan says ${expected.amountCents} (smallest currency unit).`);
  }
  if ((price.unit_price?.currency_code ?? "").toUpperCase() !== expected.currency.toUpperCase()) {
    problems.push(`${label}: Paddle currency ${price.unit_price?.currency_code ?? "?"} but the plan says ${expected.currency}.`);
  }
  const cycle = price.billing_cycle;
  if (!cycle || cycle.interval !== PADDLE_INTERVAL[expected.interval] || cycle.frequency !== 1) {
    problems.push(`${label}: Paddle bills every ${cycle ? `${cycle.frequency} ${cycle.interval}` : "(one-time)"}, not every 1 ${PADDLE_INTERVAL[expected.interval]}.`);
  }
  if (price.trial_period) problems.push(`${label}: the Paddle price has its own trial; remove it (GarnishTable runs the trial itself).`);
  return problems;
}

/**
 * Validates the whole mapping against the Plan catalog and Paddle, then — only when `apply` is set
 * AND there were no problems at all — writes the ids. All-or-nothing: one bad id writes nothing.
 */
export async function applyPaddlePriceMapping(options: {
  mapping: PaddlePriceMapping;
  fetchPrice: (priceId: string) => Promise<PaddlePrice | null>;
  apply: boolean;
}): Promise<PriceMappingResult> {
  const result: PriceMappingResult = { problems: [], priceChanges: [], productChanges: [], applied: false };
  const plans = await Plan.find({ code: { $in: Object.keys(options.mapping) } });

  for (const [planCode, ids] of Object.entries(options.mapping)) {
    const plan = plans.find((p) => p.code === planCode);
    if (!plan) {
      result.problems.push(`${planCode}: no such plan.`);
      continue;
    }
    if (!plan.isActive) result.problems.push(`${planCode}: plan is retired (isActive: false); only active plans are sold.`);
    if (plan.providerProductId !== ids.productId) result.productChanges.push({ planCode, from: plan.providerProductId ?? undefined, to: ids.productId });

    for (const pricing of plan.pricing) {
      const interval = pricing.interval as "monthly" | "yearly";
      const priceId = ids[interval];
      const label = `${planCode} ${interval}`;
      if (!priceId) {
        result.problems.push(`${label}: the plan sells this interval but no price id was given.`);
        continue;
      }
      if (pricing.amountCents == null || !pricing.currency) {
        result.problems.push(`${label}: the plan has no amount/currency to check the Paddle price against.`);
        continue;
      }
      const price = await options.fetchPrice(priceId);
      result.problems.push(
        ...checkPaddlePrice(price, { priceId, productId: ids.productId, interval, amountCents: pricing.amountCents, currency: pricing.currency, label })
      );
      if (pricing.providerPriceId !== priceId) result.priceChanges.push({ planCode, interval, from: pricing.providerPriceId ?? undefined, to: priceId });
    }
    for (const interval of ["monthly", "yearly"] as const) {
      if (ids[interval] && !plan.pricing.some((p) => p.interval === interval)) {
        result.problems.push(`${planCode} ${interval}: a price id was given but the plan has no ${interval} price.`);
      }
    }
  }

  // A price id may only ever mean one plan price — including plans outside this mapping.
  const given = Object.values(options.mapping).flatMap((ids) => [ids.monthly, ids.yearly].filter(Boolean) as string[]);
  const clashes = await Plan.find({ code: { $nin: Object.keys(options.mapping) }, "pricing.providerPriceId": { $in: given } }, { code: 1 });
  for (const clash of clashes) result.problems.push(`${clash.code}: already uses one of these price ids.`);

  if (!options.apply || result.problems.length) return result;

  for (const change of result.productChanges) {
    await Plan.updateOne({ code: change.planCode }, { $set: { providerProductId: change.to } });
  }
  for (const change of result.priceChanges) {
    await Plan.updateOne({ code: change.planCode, "pricing.interval": change.interval }, { $set: { "pricing.$.providerPriceId": change.to } });
  }
  result.applied = true;
  return result;
}

/**
 * Phase 89 — scripts/setPaddlePriceIds.ts's command line: `--file <mapping.json>` (required),
 * `--apply` (write; otherwise a dry run), `--allow-sandbox` (only to rehearse against the sandbox
 * catalog). Throws a message meant for the operator; never echoes the API key.
 */
export function parsePriceScriptArgs(
  args: string[],
  context: { paddleEnv: "sandbox" | "production"; hasApiKey: boolean }
): { file: string; apply: boolean } {
  const known = new Set(["--file", "--apply", "--allow-sandbox"]);
  const fileIndex = args.indexOf("--file");
  const file = fileIndex >= 0 ? args[fileIndex + 1] : undefined;
  const unknown = args.filter((arg, i) => arg.startsWith("--") && !known.has(arg) && i !== fileIndex + 1);
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(", ")}. Usage: setPaddlePriceIds --file <mapping.json> [--apply] [--allow-sandbox]`);
  if (!file || file.startsWith("--")) throw new Error("Usage: setPaddlePriceIds --file <mapping.json> [--apply] [--allow-sandbox]");
  if (!context.hasApiKey) throw new Error("PADDLE_API_KEY is not set.");
  if (context.paddleEnv !== "production" && !args.includes("--allow-sandbox")) {
    throw new Error(`PADDLE_ENV is "${context.paddleEnv}". Live price ids must be checked against production; pass --allow-sandbox only to rehearse.`);
  }
  return { file, apply: args.includes("--apply") };
}
