import type { PlanDoc } from "../models/Plan.js";

/**
 * Phase 24 — the foundational "what is this account allowed to use" mechanism. Deliberately
 * plan-level only this phase (no per-subscription override layer) — see Plan.ts's entitlements
 * array, which is real, seeded data, not a placeholder. NOT wired into any existing route's
 * authorization chain yet (custom domains, business analytics, business promotions all keep
 * working exactly as before, ungated) — per the brief's explicit instruction not to prematurely
 * gate existing features merely because the architecture now makes it possible. Centralizing the
 * check here, rather than scattering `if (plan.type === "AGENCY")`-style checks through
 * controllers, is what lets a future phase start enforcing entitlements without touching this file.
 */

export type EntitlementValue = boolean | number | string;

export function getEntitlements(plan: Pick<PlanDoc, "entitlements">): Record<string, EntitlementValue> {
  const result: Record<string, EntitlementValue> = {};
  for (const entry of plan.entitlements) {
    result[entry.key] = entry.value as EntitlementValue;
  }
  return result;
}

/** A boolean entitlement is present-and-true; a numeric one is present-and-positive (a limit of 0
 *  means "not entitled," not "unlimited" — there is no "unlimited" sentinel this phase, avoiding an
 *  arbitrary magic number); any other present value is truthy. An absent key is always false —
 *  there is no implicit default-allow. */
export function hasEntitlement(plan: Pick<PlanDoc, "entitlements">, key: string): boolean {
  const entry = plan.entitlements.find((e) => e.key === key);
  if (!entry) return false;
  if (typeof entry.value === "boolean") return entry.value;
  if (typeof entry.value === "number") return entry.value > 0;
  return Boolean(entry.value);
}
