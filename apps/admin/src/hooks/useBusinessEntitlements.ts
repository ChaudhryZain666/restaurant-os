import { useEffect, useState } from "react";
import { apiClient } from "../lib/api";

type EntitlementValue = boolean | number | string;
type EntitlementSource = "business" | "agency" | "lapsed" | "default";

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
 * `source: "default"` means no plan was found ANYWHERE in this owner's history — the boolean-default
 * convention (entitlement.service.ts) treats that as allowed — `has()` reflects that.
 *
 * Phase 63 fix — `source: "lapsed"` (a real subscription existed, e.g. an expired trial or a
 * cancelled/expired paid subscription, but nothing is live now) is a DIFFERENT null-entitlements
 * case, and must resolve to DENIED, not allowed. Before this fix, `has()` only checked "is
 * `entitlements` null," so `"lapsed"` was silently treated exactly like `"default"` — the frontend
 * kept showing a fully-unlocked page even though the server's own `requireEntitlement` middleware
 * would already reject the same action with a 403. That gap (API correctly denies, UI still invites
 * the click) is exactly what this hook exists to prevent.
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

  /** Mirrors hasFeatureEntitlement's own precedence exactly, so this can never disagree with the
   *  server: "lapsed" denies; genuinely no subscription history anywhere ("default") allows; a real
   *  plan's own key decides otherwise. */
  function has(key: string): boolean {
    if (source === "lapsed") return false;
    if (!entitlements) return true;
    const value = entitlements[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    return Boolean(value);
  }

  return { entitlements, source, loading, has };
}
