import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams, useLocation, Link } from "react-router-dom";
import { AGENCY_WHITE_LABEL_FEATURES, agencyRoleGrantsPermission, agencyRoleHasPermission, type AgencyMembershipRole, type AgencyWhiteLabelFeature, type ClientCommercialTerms } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { useBusiness } from "../context/BusinessContext";
import { IconStore } from "../components/icons";
import { businessJourneyStage, JourneySteps } from "../lib/agencyJourney";

function formatCommercialPrice(amountCents: number, currency: string): string {
  return (amountCents / 100).toLocaleString(undefined, { style: "currency", currency });
}

interface BusinessDetail {
  id: string;
  name: string;
  slug: string;
  status: string;
  whiteLabelFeatures?: AgencyWhiteLabelFeature[];
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

interface DomainRow {
  id: string;
  hostname: string;
  status: "pending_verification" | "verified" | "active";
}

interface BusinessDetailResponse {
  business: BusinessDetail;
  owner: OwnerDetail | null;
  locations: LocationRow[];
  subscription: SubscriptionSnapshot | null;
  domains: DomainRow[];
  commercialTerms: ClientCommercialTerms | null;
}

interface RevealedPassword {
  ownerEmail: string;
  password: string;
}

const DOMAIN_STATUS_TONE: Record<DomainRow["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  verified: "warning",
  pending_verification: "neutral",
};

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
  const location = useLocation();
  // Phase 59 — one-time values handed off from ClientProvisioningWizard right after creation
  // (Section 7's "land on a useful Client Detail view"). Read once; a page refresh naturally loses
  // router state, which is fine — neither value is retrievable from the server anyway (the password
  // is never persisted in plaintext, and a failed commercial-terms save is just a past event).
  const [handoffState] = useState(
    () => (location.state as { revealedPassword?: RevealedPassword; commercialTermsError?: string } | null) ?? null
  );

  const [data, setData] = useState<BusinessDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<RevealedPassword | null>(handoffState?.revealedPassword ?? null);
  const [editingCommercial, setEditingCommercial] = useState(false);
  const [commercialDraft, setCommercialDraft] = useState({ planLabel: "", priceDollars: "", currency: "USD", billingCycle: "monthly" as "monthly" | "yearly", status: "active" as "trial" | "active" | "cancelled" });
  const [savingCommercial, setSavingCommercial] = useState(false);
  const [whiteLabelDraft, setWhiteLabelDraft] = useState<AgencyWhiteLabelFeature[]>([]);
  const [savingWhiteLabel, setSavingWhiteLabel] = useState(false);
  const [whiteLabelMessage, setWhiteLabelMessage] = useState<string | null>(null);

  useEffect(() => {
    setWhiteLabelDraft(data?.business.whiteLabelFeatures ?? []);
  }, [data?.business.id, data?.business.whiteLabelFeatures]);

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

  async function handleSaveWhiteLabel() {
    if (!activeAgencyId || !businessId) return;
    setSavingWhiteLabel(true);
    setError(null);
    setWhiteLabelMessage(null);
    try {
      const res = await apiClient.request<{ business: BusinessDetail }>(
        `/agencies/${activeAgencyId}/businesses/${businessId}/white-label`,
        { method: "PUT", body: { enabledFeatures: whiteLabelDraft.filter((feature) => feature !== "custom_domain" && feature !== "email_branding") } }
      );
      setData((current) => current ? { ...current, business: res.business } : current);
      setWhiteLabelDraft(res.business.whiteLabelFeatures ?? []);
      setWhiteLabelMessage("Client white-label options saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingWhiteLabel(false);
    }
  }

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

  function openCommercialEditor() {
    const t = data?.commercialTerms;
    setCommercialDraft({
      planLabel: t?.planLabel ?? "",
      priceDollars: t?.priceAmountCents !== undefined ? (t.priceAmountCents / 100).toString() : "",
      currency: t?.currency ?? "USD",
      billingCycle: t?.billingCycle ?? "monthly",
      status: t?.status ?? "active",
    });
    setEditingCommercial(true);
  }

  async function handleSaveCommercial(e: FormEvent) {
    e.preventDefault();
    if (!activeAgencyId || !businessId) return;
    setSavingCommercial(true);
    setError(null);
    try {
      const priceCents = commercialDraft.priceDollars ? Math.round(Number(commercialDraft.priceDollars) * 100) : undefined;
      await apiClient.request(`/agencies/${activeAgencyId}/businesses/${businessId}/commercial-terms`, {
        method: "PUT",
        body: {
          planLabel: commercialDraft.planLabel || undefined,
          priceAmountCents: priceCents,
          currency: commercialDraft.currency || "USD",
          billingCycle: commercialDraft.billingCycle,
          status: commercialDraft.status,
        },
      });
      setEditingCommercial(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingCommercial(false);
    }
  }

  if (!activeAgencyId || !businessId) return null;

  const isCurrentlyEntered = activeBusinessId === businessId;
  const canManageBusiness = myRole ? agencyRoleHasPermission(myRole, "agency.businesses.manage") : false;
  const canReadBilling = myRole ? agencyRoleGrantsPermission(myRole, "billing.read") : false;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/agency/businesses" className="text-sm font-medium text-muted hover:text-foreground">
        ← Back to clients
      </Link>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {resendMessage && <Alert tone="success">{resendMessage}</Alert>}
      {handoffState?.commercialTermsError && (
        <Alert tone="warning" role="alert">
          Client created, but commercial terms couldn't be saved ({handoffState.commercialTermsError}). Set them below.
        </Alert>
      )}
      {revealedPassword && (
        <Alert tone="warning" role="alert">
          <div className="flex flex-col gap-2">
            <p className="font-medium">
              Owner access created for {revealedPassword.ownerEmail}. Share this temporary password with them now — it
              will not be shown again, and they'll be required to set their own password the first time they sign in.
            </p>
            <div className="flex items-center gap-2">
              <code className="rounded bg-background px-2 py-1 font-mono text-sm text-foreground">{revealedPassword.password}</code>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(revealedPassword.password)}
                className="text-sm font-medium text-primary hover:underline"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setRevealedPassword(null)}
                className="ml-auto text-sm font-medium text-muted hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </Alert>
      )}

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
            <h2 className="mb-2 font-heading text-lg font-medium text-foreground">Onboarding</h2>
            <JourneySteps
              stage={businessJourneyStage({ status: data.business.status, ownerInvitePending: data.owner?.invitePending ?? false })}
            />
          </Card>

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
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-heading text-lg font-medium text-foreground">Commercial</h2>
              {canManageBusiness && !editingCommercial && (
                <button onClick={openCommercialEditor} className="text-sm font-medium text-primary hover:underline">
                  {data.commercialTerms ? "Edit" : "Set up"}
                </button>
              )}
            </div>
            <p className="mb-2 text-xs text-muted">
              What YOUR agency charges this client for your services — not collected by the platform, and separate
              from what your agency pays the platform (see Billing).
            </p>
            {editingCommercial ? (
              <form onSubmit={handleSaveCommercial} className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Plan / tier label
                  <input
                    value={commercialDraft.planLabel}
                    onChange={(e) => setCommercialDraft({ ...commercialDraft, planLabel: e.target.value })}
                    placeholder="e.g. Growth"
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Client price
                  <div className="flex items-center gap-1.5">
                    <input
                      value={commercialDraft.currency}
                      onChange={(e) => setCommercialDraft({ ...commercialDraft, currency: e.target.value.toUpperCase() })}
                      maxLength={3}
                      className="w-16 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={commercialDraft.priceDollars}
                      onChange={(e) => setCommercialDraft({ ...commercialDraft, priceDollars: e.target.value })}
                      placeholder="99.00"
                      className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                    />
                  </div>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Billing cycle
                  <select
                    value={commercialDraft.billingCycle}
                    onChange={(e) => setCommercialDraft({ ...commercialDraft, billingCycle: e.target.value as "monthly" | "yearly" })}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Status
                  <select
                    value={commercialDraft.status}
                    onChange={(e) => setCommercialDraft({ ...commercialDraft, status: e.target.value as "trial" | "active" | "cancelled" })}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="submit" size="sm" disabled={savingCommercial}>
                    {savingCommercial ? "Saving..." : "Save"}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditingCommercial(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            ) : data.commercialTerms ? (
              <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
                <dt className="text-muted">Plan</dt>
                <dd className="text-foreground">{data.commercialTerms.planLabel ?? "—"}</dd>
                <dt className="text-muted">Client price</dt>
                <dd className="text-foreground">
                  {data.commercialTerms.priceAmountCents !== undefined
                    ? `${formatCommercialPrice(data.commercialTerms.priceAmountCents, data.commercialTerms.currency)}${
                        data.commercialTerms.billingCycle ? `/${data.commercialTerms.billingCycle === "monthly" ? "mo" : "yr"}` : ""
                      }`
                    : "—"}
                </dd>
                <dt className="text-muted">Status</dt>
                <dd>
                  <Badge tone={data.commercialTerms.status === "active" ? "success" : data.commercialTerms.status === "trial" ? "warning" : "neutral"}>
                    {data.commercialTerms.status}
                  </Badge>
                </dd>
                <dt className="text-muted">Platform subscription</dt>
                <dd className="text-foreground">{data.subscription ? "This client's own" : "Covered by agency"}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted">Not configured yet.</p>
            )}
          </Card>

          <Card className="flex flex-col gap-3">
            <div>
              <h2 className="font-heading text-lg font-medium text-foreground">White-label options</h2>
              <p className="text-sm text-muted">Choose the white-label capabilities offered to this restaurant. Only options enabled in Agency Settings can be assigned here.</p>
            </div>
            {whiteLabelMessage && <Alert tone="success">{whiteLabelMessage}</Alert>}
            {!currentAgency?.whiteLabelEnabled ? (
              <Alert tone="neutral">White-label mode is off for this agency. Enable it in Agency Settings before assigning options.</Alert>
            ) : (currentAgency.whiteLabelOfferings ?? []).length === 0 ? (
              <Alert tone="neutral">Your agency has not selected any white-label offerings yet. Configure the available options in Agency Settings first.</Alert>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  {AGENCY_WHITE_LABEL_FEATURES.filter((feature) => currentAgency.whiteLabelOfferings?.includes(feature)).map((feature) => {
                    const labels: Record<AgencyWhiteLabelFeature, string> = {
                      storefront_branding: "Storefront branding",
                      custom_domain: "Custom domain",
                      hide_platform_branding: "Hide platform branding",
                      support_branding: "Branded support",
                      email_branding: "Branded emails",
                      branded_login: "Branded sign-in",
                    };
                    // These capabilities need infrastructure not yet implemented. Keep previously
                    // stored choices visible as pending, but never let a checkbox imply they are live.
                    const pendingSetup = feature === "custom_domain" || feature === "email_branding";
                    const setupNote: Partial<Record<AgencyWhiteLabelFeature, string>> = {
                      custom_domain: "Pending: agency-domain routing is not connected yet.",
                      hide_platform_branding: "Active on the storefront footer; other platform references still need an audit.",
                      email_branding: "Pending: the current sender is deployment-wide; per-agency sender verification is not configured.",
                      branded_login: "Works only when the restaurant is resolved on an active custom domain; agency-domain routing is not connected yet.",
                      storefront_branding: "Applies the agency primary color; agency logo/name still need broader storefront integration.",
                    };
                    return (
                      <label key={feature} className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={!pendingSetup && whiteLabelDraft.includes(feature)}
                          onChange={(e) => setWhiteLabelDraft((current) => e.target.checked ? [...new Set([...current, feature])] : current.filter((item) => item !== feature))}
                          disabled={!agencyRoleHasPermission(myRole, "agency.businesses.manage") || savingWhiteLabel || pendingSetup}
                        />
                        <span className="flex flex-col gap-1">
                          <span>{labels[feature]}{pendingSetup ? " — setup required" : ""}</span>
                          {setupNote[feature] && <span className="text-xs text-muted">{setupNote[feature]}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
                {agencyRoleHasPermission(myRole, "agency.businesses.manage") && (
                  <div>
                    <Button size="sm" onClick={handleSaveWhiteLabel} disabled={savingWhiteLabel}>
                      {savingWhiteLabel ? "Saving..." : "Save client options"}
                    </Button>
                  </div>
                )}
              </>
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
                    <Link to={`/agency/locations/${l.id}`} className="font-medium text-foreground hover:underline">
                      {l.name}
                    </Link>
                    <span className="text-muted">/{l.slug}</span>
                    <Badge tone={l.status === "active" ? "success" : "neutral"}>{l.status}</Badge>
                    {l.settings?.timezone && <span className="text-xs text-muted">{l.settings.timezone}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-heading text-lg font-medium text-foreground">Domains</h2>
            {data.domains.length === 0 ? (
              <p className="text-sm text-muted">
                No custom domain configured yet — the owner can set one up from their Settings page.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.domains.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="font-medium text-foreground">{d.hostname}</span>
                    <Badge tone={DOMAIN_STATUS_TONE[d.status]}>{d.status.replace("_", " ")}</Badge>
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
