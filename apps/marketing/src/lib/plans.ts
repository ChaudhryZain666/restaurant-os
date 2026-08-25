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
 *  hardcoded pricing source. See publicPlan.controller.ts for what's returned and why. */
export function usePublicPlans() {
  const [plans, setPlans] = useState<PublicPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ plans: PublicPlan[] }>("/public/plans")
      .then((res) => setPlans(res.plans))
      .catch((err) => setError((err as Error).message));
  }, []);

  return { plans, error };
}

export function formatPlanPrice(pricing: PublicPlanPricing[], interval: "monthly" | "yearly"): string | null {
  const entry = pricing.find((p) => p.interval === interval);
  if (!entry?.amountCents || !entry.currency) return null;
  return (entry.amountCents / 100).toLocaleString(undefined, { style: "currency", currency: entry.currency, maximumFractionDigits: 0 });
}
