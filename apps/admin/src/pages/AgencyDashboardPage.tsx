import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Agency, Plan, Subscription } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useAgency } from "../context/AgencyContext";

interface AgencyDashboardData {
  subscription: Subscription | null;
  plan: Plan | null;
  usage: { maxBusinesses: number; businessCount: number };
  businessCount: number;
  activeBusinessCount: number;
  businessesNeedingSetup: number;
  locationsTotal: number;
  domainsConfiguredCount: number;
  pendingOwnerInvites: number;
  pendingMemberInvites: number;
}

const SUBSCRIPTION_STATUS_TONE: Record<Subscription["status"], "success" | "neutral" | "warning" | "danger"> = {
  trialing: "warning",
  active: "success",
  past_due: "danger",
  cancelling: "warning",
  cancelled: "neutral",
  expired: "neutral",
};

/**
 * Phase 25 — the agency-scoped landing page. Two very different states: an account with no agency
 * yet sees a minimal self-serve "create an agency" form (see agency.controller.ts's createAgency —
 * any customer/agency_member account can do this); an account already in one or more agencies sees
 * a switcher (if more than one) and a summary of the active agency.
 *
 * Phase 28 — replaced the two-stat-card placeholder with a real dashboard, reading a single new
 * GET /agencies/:agencyId/dashboard endpoint (agency.controller.ts's getAgencyDashboard). Every
 * number shown here traces to a real query — no placeholder metrics.
 */
export function AgencyDashboardPage() {
  const { user, refreshUser } = useAuth();
  const { agencies, activeAgencyId, loading, switchAgency, refetchAgencies } = useAgency();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [contactEmail, setContactEmail] = useState(user?.email ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [data, setData] = useState<AgencyDashboardData | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  const activeAgency = agencies.find((a) => a.id === activeAgencyId);

  useEffect(() => {
    if (!activeAgencyId) return;
    setDataLoading(true);
    apiClient
      .request<AgencyDashboardData>(`/agencies/${activeAgencyId}/dashboard`)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setDataLoading(false));
  }, [activeAgencyId]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiClient.request<{ agency: Agency }>("/agencies", { method: "POST", body: { name, slug, contactEmail } });
      await refreshUser();
      await refetchAgencies();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-muted">Loading...</p>;

  if (agencies.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Create your agency</h1>
          <p className="text-sm text-muted">
            An agency can manage multiple businesses, each with their own locations, staff, and owner.
          </p>
        </div>
        {error && (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        )}
        <Card className="flex flex-col gap-3">
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Agency name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Slug
              <input
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="my-agency"
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Contact email
              <input
                required
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <Button type="submit" size="sm" disabled={creating} className="self-start sm:col-span-2">
              {creating ? "Creating..." : "Create agency"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">{activeAgency?.name ?? "Agency"}</h1>
          <p className="text-sm text-muted">
            Your role: <Badge tone="neutral">{activeAgency?.myRole}</Badge>
          </p>
        </div>
        {agencies.length > 1 && (
          <label className="flex items-center gap-1.5 text-sm">
            <span className="text-muted">Agency:</span>
            <select
              value={activeAgencyId ?? ""}
              onChange={(e) => switchAgency(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            >
              {agencies.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {dataLoading ? (
        <p className="text-muted">Loading dashboard...</p>
      ) : (
        data && (
          <>
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-heading text-sm font-medium text-foreground">Subscription</p>
                {data.subscription && data.plan ? (
                  <p className="flex items-center gap-2 text-sm text-muted">
                    {data.plan.name}
                    <Badge tone={SUBSCRIPTION_STATUS_TONE[data.subscription.status]}>{data.subscription.status}</Badge>
                  </p>
                ) : (
                  <p className="text-sm text-muted">No subscription yet.</p>
                )}
              </div>
              <Link to="/agency/billing" className="text-sm font-medium text-primary hover:underline">
                Manage billing
              </Link>
            </Card>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <p className="text-sm text-muted">Businesses</p>
                <p className="font-heading text-2xl font-semibold text-foreground">
                  {data.usage.businessCount} / {data.usage.maxBusinesses}
                </p>
                <Link to="/agency/businesses" className="text-sm font-medium text-primary hover:underline">
                  View businesses
                </Link>
              </Card>
              <Card>
                <p className="text-sm text-muted">Active businesses</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{data.activeBusinessCount}</p>
                <p className="text-xs text-muted">
                  {data.businessesNeedingSetup > 0
                    ? `${data.businessesNeedingSetup} still need setup`
                    : "All set up"}
                </p>
              </Card>
              <Card>
                <p className="text-sm text-muted">Locations</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{data.locationsTotal}</p>
                <p className="text-xs text-muted">Across every managed business</p>
              </Card>
              <Card>
                <p className="text-sm text-muted">Domains configured</p>
                <p className="font-heading text-2xl font-semibold text-foreground">{data.domainsConfiguredCount}</p>
                <p className="text-xs text-muted">of {data.businessCount} businesses</p>
              </Card>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Card>
                <p className="text-sm text-muted">Team members</p>
                <p className="font-heading text-2xl font-semibold text-foreground">
                  {data.pendingMemberInvites > 0 ? `${data.pendingMemberInvites} invite(s) pending` : "All accepted"}
                </p>
                <Link to="/agency/members" className="text-sm font-medium text-primary hover:underline">
                  Manage team
                </Link>
              </Card>
              <Card>
                <p className="text-sm text-muted">Owner invitations</p>
                <p className="font-heading text-2xl font-semibold text-foreground">
                  {data.pendingOwnerInvites > 0 ? `${data.pendingOwnerInvites} pending` : "All accepted"}
                </p>
                <Link to="/agency/businesses" className="text-sm font-medium text-primary hover:underline">
                  View businesses
                </Link>
              </Card>
            </div>
          </>
        )
      )}
    </div>
  );
}
