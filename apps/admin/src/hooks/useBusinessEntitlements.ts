import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

type EntitlementValue = boolean | number | string;
type EntitlementSource = "business" | "agency" | "default";

interface EntitlementsResponse {
  entitlements: Record<string, EntitlementValue> | null;
  source: EntitlementSource;
}

/**
 * Phase 39 — the shared UI-side read for `GET /businesses/:businessId/subscription/entitlements`,
 * which now resolves through the same business -> agency-inherited -> default precedence the
 * server enforces (entitlementLimit.service.ts). This hook is convenience only: every page using it
 * still relies on the server's own `requireEntitlement` middleware as the real authorization
 * boundary — this just lets the UI show an accurate locked/upgrade state instead of a 403 the user
 * only discovers after clicking.
 *
 * `entitlements === null` while `loading` is true means "don't know yet" (treat conservatively,
 * i.e. don't render an upgrade prompt prematurely); once loaded, `null` entitlements with
 * `source: "default"` means no plan was found at all, which the boolean-default convention
 * (entitlement.service.ts) treats as allowed — `has()` reflects that.
 */
export function useBusinessEntitlements(businessId: string | undefined | null) {
  const [entitlements, setEntitlements] = useState<Record<string, EntitlementValue> | null>(null);
  const [source, setSource] = useState<EntitlementSource>("default");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiClient
      .request<EntitlementsResponse>(`/businesses/${businessId}/subscription/entitlements`)
      .then((res) => {
        setEntitlements(res.entitlements);
        setSource(res.source);
      })
      .catch(() => {
        // Treated the same as "no plan found" — the server-side gate remains authoritative either way.
        setEntitlements(null);
        setSource("default");
      })
      .finally(() => setLoading(false));
  }, [businessId]);

  /** No entitlements resolved at all (source: "default") means the boolean-default-TRUE convention
   *  applies — same rule the server's hasFeatureEntitlement uses, so this can't disagree with it. */
  function has(key: string): boolean {
    if (!entitlements) return true;
    const value = entitlements[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    return Boolean(value);
  }

  return { entitlements, source, loading, has };
}
