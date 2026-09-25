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

export function formatPlanPrice(pricing: PublicPlanPricing[], interval: "monthly" | "yearly"): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  return (entry.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: entry.currency, maximumFractionDigits: 0 });
}
