import { useEffect, useState } from "react";
import { apiClient } from "./api";

export interface PublicPlanPricing {
  interval: "monthly" | "yearly";
  amountCents?: number;
  currency?: string;
}

export interface PublicPlanEntitlement {
  key: string;
  value: boolean | number | string;
}

export interface PublicPlan {
  code: string;
  name: string;
  type: "OWNER" | "AGENCY";
  description?: string;
  pricing: PublicPlanPricing[];
  entitlements: PublicPlanEntitlement[];
  trialDays?: number;
}

/** Shared by PricingPage and the homepage's compact teaser — one fetch, one shape, never a second
 *  hardcoded pricing source. See publicPlan.controller.ts for what's returned and why.
 *
 *  `retry()` re-runs the fetch — the request only ever fires once on mount otherwise, so a
 *  transient failure (the API mid-restart, a dropped connection) left the error state permanent
 *  for the rest of the page's life with no way to recover short of a full reload. */
export function usePublicPlans() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiClient
      .request<{ plans: PublicPlan[] }>("/public/plans")
      .then((res) => {
        if (!cancelled) setPlans(res.plans);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { plans, error, retry: () => setAttempt((a) => a + 1) };
}

export function formatPlanPrice(
  pricing: PublicPlanPricing[],
  interval: "monthly" | "yearly"
): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  return (entry.amountCents / 100).toLocaleString(undefined, {
    style: "currency",
    currency: entry.currency,
    maximumFractionDigits: 0,
  });
}

const ENTITLEMENT_LABELS: Record<string, string> = {
  custom_domains: "Custom domain / white-label",
  business_analytics: "Business analytics",
  business_promotions: "Promotions & discount codes",
};

/** A plan's real entitlements as plain-language feature lines — never a hardcoded feature list. */
export function planFeatures(plan: PublicPlan): string[] {
  const features: string[] = [];
  for (const e of plan.entitlements) {
    if (e.key === "max_locations" && typeof e.value === "number") {
      features.push(`${e.value} location${e.value === 1 ? "" : "s"} included`);
    } else if (e.key === "max_businesses" && typeof e.value === "number") {
      features.push(`${e.value} businesses included`);
    } else if (ENTITLEMENT_LABELS[e.key] && e.value === true) {
      features.push(ENTITLEMENT_LABELS[e.key]);
    }
  }
  if (plan.trialDays) features.unshift(`${plan.trialDays}-day free trial`);
  return features;
}
