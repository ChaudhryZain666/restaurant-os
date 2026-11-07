import { Plan } from "../models/Plan.js";
import type { LemonSqueezyVariant } from "../billing/LemonSqueezyBillingProvider.js";
import type { PriceMappingResult } from "./paddlePriceMapping.service.js";

/**
 * Loads Lemon Squeezy product/variant ids into the Plan catalog (Plan.providerProductId and
 * Plan.pricing[].providerPriceId — a variant id is this provider's "price"). Same all-or-nothing
 * contract as paddlePriceMapping.service.ts: every variant is checked against Lemon Squeezy first —
 * published, a subscription, in the named product, billing every 1 month/year at exactly the plan's
 * amount, with no Lemon Squeezy-side trial (the trial is ours) — and nothing is written if any check
 * fails. Used by scripts/setLemonSqueezyVariantIds.ts; writes nothing to Lemon Squeezy.
 */

export interface PlanVariantIds {
  productId: string;
  monthly?: string;
  yearly?: string;
}

export type LemonSqueezyVariantMapping = Record<string, PlanVariantIds>;

const NUMERIC_ID = /^\d+$/;
const LS_INTERVAL = { monthly: "month", yearly: "year" } as const;

export function parseVariantMapping(input: unknown): { mapping: LemonSqueezyVariantMapping; problems: string[] } {
  const problems: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { mapping: {}, problems: ["The mapping must be a JSON object of plan code → { productId, monthly, yearly }."] };
  }
  const mapping: LemonSqueezyVariantMapping = {};
  for (const [planCode, raw] of Object.entries(input as Record<string, unknown>)) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const ids: PlanVariantIds = { productId: String(entry.productId ?? "") };
    if (!NUMERIC_ID.test(ids.productId)) problems.push(`${planCode}: productId "${ids.productId}" is not a Lemon Squeezy product id (digits only).`);
    for (const interval of ["monthly", "yearly"] as const) {
      if (entry[interval] === undefined) continue;
      const id = String(entry[interval]);
      if (!NUMERIC_ID.test(id)) problems.push(`${planCode}: ${interval} "${id}" is not a Lemon Squeezy variant id (digits only).`);
      ids[interval] = id;
    }
    if (!ids.monthly && !ids.yearly) problems.push(`${planCode}: no monthly or yearly variant id given.`);
    mapping[planCode] = ids;
  }
  if (!Object.keys(mapping).length) problems.push("The mapping is empty.");
  const all = Object.values(mapping).flatMap((ids) => [ids.monthly, ids.yearly].filter(Boolean) as string[]);
  const dupes = all.filter((id, i) => all.indexOf(id) !== i);
  if (dupes.length) problems.push(`The same variant id is used more than once: ${[...new Set(dupes)].join(", ")}.`);
  return { mapping, problems };
}

export function checkLemonSqueezyVariant(
  variant: LemonSqueezyVariant | null,
  expected: { variantId: string; productId: string; interval: "monthly" | "yearly"; amountCents: number; testMode: boolean; label: string }
): string[] {
  const { label } = expected;
  if (!variant) return [`${label}: variant ${expected.variantId} was not found with this API key (a test-mode id used with a live key, or a typo).`];
  const problems: string[] = [];
  if (variant.status !== "published") problems.push(`${label}: variant is "${variant.status}", not published.`);
  if (String(variant.product_id) !== expected.productId) problems.push(`${label}: variant belongs to product ${variant.product_id}, not ${expected.productId}.`);
  if (!variant.is_subscription) problems.push(`${label}: variant is not a subscription.`);
  if (variant.price !== expected.amountCents) problems.push(`${label}: Lemon Squeezy charges ${variant.price ?? "?"} but the plan says ${expected.amountCents} (cents).`);
  if (variant.interval !== LS_INTERVAL[expected.interval] || (variant.interval_count ?? 1) !== 1) {
    problems.push(`${label}: Lemon Squeezy bills every ${variant.interval_count ?? "?"} ${variant.interval ?? "(one-time)"}, not every 1 ${LS_INTERVAL[expected.interval]}.`);
  }
  if (variant.has_free_trial) problems.push(`${label}: the variant has its own free trial; remove it (GarnishTable runs the trial itself).`);
  if (typeof variant.test_mode === "boolean" && variant.test_mode !== expected.testMode) {
    problems.push(`${label}: variant is ${variant.test_mode ? "test" : "live"} mode but LEMONSQUEEZY_TEST_MODE says ${expected.testMode ? "test" : "live"}.`);
  }
  return problems;
}

export async function applyLemonSqueezyVariantMapping(options: {
  mapping: LemonSqueezyVariantMapping;
  fetchVariant: (variantId: string) => Promise<LemonSqueezyVariant | null>;
  testMode: boolean;
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
      const variantId = ids[interval];
      const label = `${planCode} ${interval}`;
      if (!variantId) {
        result.problems.push(`${label}: the plan sells this interval but no variant id was given.`);
        continue;
      }
      if (pricing.amountCents == null || (pricing.currency ?? "").toUpperCase() !== "USD") {
        result.problems.push(`${label}: the plan needs a USD amount to check the variant against (the store sells in USD).`);
        continue;
      }
      const variant = await options.fetchVariant(variantId);
      result.problems.push(
        ...checkLemonSqueezyVariant(variant, { variantId, productId: ids.productId, interval, amountCents: pricing.amountCents, testMode: options.testMode, label })
      );
      if (pricing.providerPriceId !== variantId) result.priceChanges.push({ planCode, interval, from: pricing.providerPriceId ?? undefined, to: variantId });
    }
    for (const interval of ["monthly", "yearly"] as const) {
      if (ids[interval] && !plan.pricing.some((p) => p.interval === interval)) {
        result.problems.push(`${planCode} ${interval}: a variant id was given but the plan has no ${interval} price.`);
      }
    }
  }

  const given = Object.values(options.mapping).flatMap((ids) => [ids.monthly, ids.yearly].filter(Boolean) as string[]);
  const clashes = await Plan.find({ code: { $nin: Object.keys(options.mapping) }, "pricing.providerPriceId": { $in: given } }, { code: 1 });
  for (const clash of clashes) result.problems.push(`${clash.code}: already uses one of these variant ids.`);

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
