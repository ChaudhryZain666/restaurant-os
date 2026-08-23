import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { agencyRoleGrantsPermission, agencyRoleHasPermission, type AgencyMembershipRole } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { useBusiness } from "../context/BusinessContext";
import { IconStore } from "../components/icons";

interface BusinessDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface OwnerDetail {
  name: string;
  email: string;
  invitePending: boolean;
}

interface LocationRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  settings?: { timezone?: string; currency?: string };
}

interface SubscriptionSnapshot {
  status: string;
  planId: string;
  currentPeriodEnd: string;
}

interface BusinessDetailResponse {
  business: BusinessDetail;
  owner: OwnerDetail | null;
  locations: LocationRow[];
  subscription: SubscriptionSnapshot | null;
}

/**
 * Phase 26 — the entry point for "Manage this business": fuller detail than
 * AgencyBusinessesPage's per-row summary (full location list, owner invite status with a resend
 * action), plus the one button that actually crosses Phase 25's "business-level, not
 * location-operational" boundary — enterBusiness() sets BusinessContext's active business and
 * routes into the SAME operational admin (Menu/Orders/Kitchen/Staff/...) a real business owner
 * uses, filtered to whatever this agency role is granted (see AGENCY_ROLE_GRANTS in
 * @restaurant/types). No impersonation: the authenticated identity stays this agency member the
 * whole time, verified server-side on every request via requireBusinessMatch/requireTenantMatch's
 * agency branches — entering a business is a client-side navigation, never a new session.
 */
export function AgencyBusinessDetailPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const { activeAgencyId, agencies } = useAgency();
  const { enterBusiness, activeBusinessId, exitBusiness } = useBusiness();
  const navigate = useNavigate();

  const [data, setData] = useState<BusinessDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  const currentAgency = agencies.find((a) => a.id === activeAgencyId);
  const myRole: AgencyMembershipRole | undefined = currentAgency?.myRole;

  async function reload() {
    if (!activeAgencyId || !businessId) return;
    const res = await apiClient.request<BusinessDetailResponse>(`/agencies/${activeAgencyId}/businesses/${businessId}`);
    setData(res);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId, businessId]);

  async function handleResendInvite() {
    if (!activeAgencyId || !businessId) return;
    setResending(true);
    setError(null);
    setResendMessage(null);
    try {
      const res = await apiClient.request<{ message: string }>(`/agencies/${activeAgencyId}/businesses/${businessId}/resend-owner-invite`, {
        method: "POST",
      });
      setResendMessage(res.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResending(false);
    }
  }

  function handleManage() {
    if (!activeAgencyId || !currentAgency || !data || !myRole) return;
    enterBusiness({ id: data.business.id, name: data.business.name }, { id: activeAgencyId, name: currentAgency.name }, myRole);
    navigate("/");
  }

  if (!activeAgencyId || !businessId) return null;

  const isCurrentlyEntered = activeBusinessId === businessId;
  const canManageBusiness = myRole ? agencyRoleHasPermission(myRole, "agency.businesses.manage") : false;
  const canReadBilling = myRole ? agencyRoleGrantsPermission(myRole, "billing.read") : false;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/agency/businesses" className="text-sm font-medium text-muted hover:text-foreground">
        ← Back to businesses
      </Link>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {resendMessage && <Alert tone="success">{resendMessage}</Alert>}

      {loading ? (
        <p className="text-muted">Loading business...</p>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-heading text-2xl font-semibold text-foreground">{data.business.name}</h1>
              <p className="text-sm text-muted">/{data.business.slug}</p>
            </div>
            {isCurrentlyEntered ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  exitBusiness();
                  navigate("/agency/businesses");
                }}
              >
                Exit management view
              </Button>
            ) : (
              <Button size="sm" onClick={handleManage} disabled={!myRole}>
                Manage this business
              </Button>
            )}
          </div>

          <Card>
            <h2 className="mb-2 font-heading text-lg font-medium text-foreground">Owner</h2>
            {data.owner ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">{data.owner.name}</span>
                <span className="text-muted">{data.owner.email}</span>
                {data.owner.invitePending && <Badge tone="warning">Invite pending</Badge>}
                {data.owner.invitePending && canManageBusiness && (
                  <button
                    onClick={handleResendInvite}
                    disabled={resending}
                    className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    {resending ? "Resending..." : "Resend invite"}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No owner account found.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-heading text-lg font-medium text-foreground">Locations</h2>
            {data.locations.length === 0 ? (
              <p className="text-sm text-muted">No locations yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.locations.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <IconStore className="h-4 w-4 shrink-0 text-muted" />
                    <span className="font-medium text-foreground">{l.name}</span>
                    <span className="text-muted">/{l.slug}</span>
                    <Badge tone={l.status === "active" ? "success" : "neutral"}>{l.status}</Badge>
                    {l.settings?.timezone && <span className="text-xs text-muted">{l.settings.timezone}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {canReadBilling && (
            <Card>
              <h2 className="mb-2 font-heading text-lg font-medium text-foreground">Subscription</h2>
              {data.subscription ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone={data.subscription.status === "active" ? "success" : "neutral"}>{data.subscription.status}</Badge>
                  <span className="text-muted">
                    Renews {new Date(data.subscription.currentPeriodEnd).toLocaleDateString()}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted">No subscription yet.</p>
              )}
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
