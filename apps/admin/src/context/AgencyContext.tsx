import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Agency, AgencyMembershipRole } from "@restaurant/types";
import { apiClient } from "../lib/api";
import { useAuth } from "./AuthContext";

type AgencyWithRole = Agency & { myRole: AgencyMembershipRole };

interface AgencyContextValue {
  /** The agency currently being operated on. Null while resolving, or if this account has no
   *  agency membership at all (the overwhelmingly common case, unaffected by this context). */
  activeAgencyId: string | null;
  /** Every agency this account has an ACTIVE membership in — empty for non-agency accounts. */
  agencies: AgencyWithRole[];
  loading: boolean;
  switchAgency: (agencyId: string) => void;
  /** Re-fetches the accessible-agencies list — call after creating an agency or accepting an
   *  agency invite (paired with AuthContext's refreshUser(), which the JWT claim itself needs). */
  refetchAgencies: () => Promise<void>;
}

const AgencyContext = createContext<AgencyContextValue | undefined>(undefined);

const STORAGE_KEY = "activeAgencyId";

/**
 * Phase 25 — the agency-switching analog of LocationContext, same "localStorage is a UI
 * preference only, never an authorization input" philosophy: every real request still goes
 * through the server-side requireAgencyMatch/requireBusinessMatch checks regardless of what this
 * context thinks is "active." Only ever populated for `agency_member`-role accounts — every other
 * role sees an empty agencies array and a null activeAgencyId, by construction.
 */
export function AgencyProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [agencies, setAgencies] = useState<AgencyWithRole[]>([]);
  const [activeAgencyId, setActiveAgencyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAgencies = useCallback(async () => {
    const { agencies: fetched } = await apiClient.request<{ agencies: AgencyWithRole[] }>("/agencies/me");
    return fetched;
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      if (!user || user.role !== "agency_member") {
        setAgencies([]);
        setActiveAgencyId(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const fetched = await fetchAgencies();
        if (cancelled) return;
        setAgencies(fetched);

        const stored = localStorage.getItem(STORAGE_KEY);
        const storedStillValid = stored && fetched.some((a) => a.id === stored);
        setActiveAgencyId(storedStillValid ? stored : (fetched[0]?.id ?? null));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    resolve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role, fetchAgencies]);

  const switchAgency = useCallback(
    (agencyId: string) => {
      if (agencyId === activeAgencyId) return;
      localStorage.setItem(STORAGE_KEY, agencyId);
      setActiveAgencyId(agencyId);
    },
    [activeAgencyId]
  );

  const refetchAgencies = useCallback(async () => {
    const fetched = await fetchAgencies();
    setAgencies(fetched);
    if (!activeAgencyId && fetched[0]) {
      localStorage.setItem(STORAGE_KEY, fetched[0].id);
      setActiveAgencyId(fetched[0].id);
    }
  }, [fetchAgencies, activeAgencyId]);

  const value = useMemo(
    () => ({ activeAgencyId, agencies, loading, switchAgency, refetchAgencies }),
    [activeAgencyId, agencies, loading, switchAgency, refetchAgencies]
  );

  return <AgencyContext.Provider value={value}>{children}</AgencyContext.Provider>;
}

export function useAgency() {
  const ctx = useContext(AgencyContext);
  if (!ctx) throw new Error("useAgency must be used within AgencyProvider");
  return ctx;
}
