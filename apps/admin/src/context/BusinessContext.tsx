import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgencyMembershipRole } from "@restaurant/types";
import { useAuth } from "./AuthContext";

interface EnteredBusiness {
  businessId: string;
  businessName: string;
  agencyId: string;
  agencyName: string;
  agencyRole: AgencyMembershipRole;
}

interface BusinessContextValue {
  /** The business currently being operated on. For a restaurant_owner/manager/staff/kitchen_staff
   *  account this is always their own `user.businessId` — zero behavior change, computed not
   *  stored. For an agency_member it's null until they explicitly "enter" a managed business (see
   *  enterBusiness), since an agency account has no business of its own. */
  activeBusinessId: string | null;
  /** True only when activeBusinessId came from an agency member's explicit enterBusiness() call —
   *  never true for a real restaurant-role account operating their own business. */
  isActingAsAgency: boolean;
  /** The caller's agency role FOR the active business — set only while isActingAsAgency, so
   *  RequireAuth/Layout can check agencyRoleGrantsPermission locally instead of an extra request. */
  agencyRoleForActiveBusiness: AgencyMembershipRole | null;
  agencyIdForActiveBusiness: string | null;
  /** Display-only (business/agency names) — carried through from the enterBusiness() call site
   *  (which already has them, having just fetched the business detail page) purely so Layout's
   *  "Managing X via Y" banner needs no extra fetch. Never used for authorization. */
  activeBusinessName: string | null;
  activeAgencyName: string | null;
  enterBusiness: (business: { id: string; name: string }, agency: { id: string; name: string }, agencyRole: AgencyMembershipRole) => void;
  exitBusiness: () => void;
}

const BusinessContext = createContext<BusinessContextValue | undefined>(undefined);

function storageKey(userId: string) {
  return `enteredBusiness:${userId}`;
}

/**
 * Phase 26 — the one seam that makes every existing operational admin page (Menu/Orders/Kitchen/
 * Delivery/Staff/Domains/Settings/...) work for an agency member with zero page-level changes.
 * Every one of those pages already resolves its scope through exactly two idioms:
 * useActiveLocationId() (LocationContext) or user!.businessId! (AuthContext) — never a URL param.
 * LocationContext is updated (this same phase) to source its businessId from this context instead
 * of reading user.businessId directly, so it transparently works for both a real business owner AND
 * an agency member who has entered a managed business.
 *
 * Same "localStorage is a UI preference only, never an authorization input" philosophy as
 * AgencyContext/LocationContext — the server independently re-verifies agency access on every
 * request via requireBusinessMatch/requireTenantMatch's agency branches (see
 * docs/multi-tenant-storefront-architecture.md's Phase 26 section). A stale/revoked entered
 * business just means every subsequent fetch 403s and the user exits back to the Agency section —
 * never a security concern, only a UX one.
 */
export function BusinessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [entered, setEntered] = useState<EnteredBusiness | null>(null);

  useEffect(() => {
    if (!user || user.role !== "agency_member") {
      setEntered(null);
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey(user.id));
      setEntered(raw ? (JSON.parse(raw) as EnteredBusiness) : null);
    } catch {
      setEntered(null);
    }
  }, [user?.id, user?.role]);

  const enterBusiness = useCallback(
    (business: { id: string; name: string }, agency: { id: string; name: string }, agencyRole: AgencyMembershipRole) => {
      if (!user) return;
      const next: EnteredBusiness = {
        businessId: business.id,
        businessName: business.name,
        agencyId: agency.id,
        agencyName: agency.name,
        agencyRole,
      };
      localStorage.setItem(storageKey(user.id), JSON.stringify(next));
      setEntered(next);
    },
    [user]
  );

  const exitBusiness = useCallback(() => {
    if (!user) return;
    localStorage.removeItem(storageKey(user.id));
    setEntered(null);
  }, [user]);

  const isAgencyAccount = user?.role === "agency_member";
  const activeBusinessId = isAgencyAccount ? (entered?.businessId ?? null) : (user?.businessId ?? null);

  const value = useMemo<BusinessContextValue>(
    () => ({
      activeBusinessId,
      isActingAsAgency: isAgencyAccount && Boolean(entered),
      agencyRoleForActiveBusiness: isAgencyAccount ? (entered?.agencyRole ?? null) : null,
      agencyIdForActiveBusiness: isAgencyAccount ? (entered?.agencyId ?? null) : null,
      activeBusinessName: isAgencyAccount ? (entered?.businessName ?? null) : null,
      activeAgencyName: isAgencyAccount ? (entered?.agencyName ?? null) : null,
      enterBusiness,
      exitBusiness,
    }),
    [activeBusinessId, isAgencyAccount, entered, enterBusiness, exitBusiness]
  );

  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error("useBusiness must be used within BusinessProvider");
  return ctx;
}
