import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { Paginated } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { IconStore } from "../components/icons";

interface AgencyBusinessSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  locationCount: number;
  subscriptionStatus: string | null;
  ownerName?: string;
  ownerEmail?: string;
  ownerInvitePending: boolean;
  domainCount: number;
}

const PAGE_SIZE = 20;

type ProvisioningMode = "invite" | "direct";

function emptyDraft() {
  return { businessName: "", businessSlug: "", ownerName: "", ownerEmail: "", locationName: "", locationSlug: "" };
}

/**
 * Phase 25 — list + create. Phase 26 added the "Manage" link into AgencyBusinessDetailPage, which
 * is where the actual "enter this business's operational admin" action lives (see that page's doc
 * comment) — this list itself stays a summary view, not the entry point.
 */
export function AgencyBusinessesPage() {
  const { activeAgencyId } = useAgency();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<AgencyBusinessSummary> | null>(null);
  const [usage, setUsage] = useState<{ maxBusinesses: number; businessCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [provisioningMode, setProvisioningMode] = useState<ProvisioningMode>("invite");
  const [creating, setCreating] = useState(false);
  // Shown exactly once, right after a "direct access" creation succeeds — never persisted beyond
  // this component's state, cleared the moment the agency dismisses it.
  const [revealedPassword, setRevealedPassword] = useState<{ ownerEmail: string; password: string } | null>(null);

  async function reload() {
    if (!activeAgencyId) return;
    const [data, entitlementsRes] = await Promise.all([
      apiClient.request<Paginated<AgencyBusinessSummary>>(`/agencies/${activeAgencyId}/businesses?page=${page}&limit=${PAGE_SIZE}`),
      apiClient.request<{ usage: { maxBusinesses: number; businessCount: number } }>(`/agencies/${activeAgencyId}/subscription/entitlements`),
    ]);
    setResult(data);
    setUsage(entitlementsRes.usage);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId, page]);

  // Phase 39 — a pre-check so the "New business" action can be disabled and explained at the
  // limit, instead of only failing with a 409 after the form is filled out. reserveBusinessSlot
  // (agencyEntitlement.service.ts) remains the real, atomic, server-side guard — this is convenience
  // only, and can be momentarily stale under concurrent creation, exactly like canCreateAnotherBusiness
  // always has been.
  const atBusinessLimit = usage !== null && usage.businessCount >= usage.maxBusinesses;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const result = await apiClient.request<{ ownerTemporaryPassword?: string }>(
        `/agencies/${activeAgencyId}/businesses`,
        { method: "POST", body: { ...draft, provisioningMode } }
      );
      if (provisioningMode === "direct" && result.ownerTemporaryPassword) {
        setRevealedPassword({ ownerEmail: draft.ownerEmail, password: result.ownerTemporaryPassword });
      }
      setDraft(emptyDraft());
      setProvisioningMode("invite");
      setShowForm(false);
      setPage(1);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (!activeAgencyId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Businesses</h1>
          <p className="text-sm text-muted">Every business this agency manages.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)} disabled={!showForm && atBusinessLimit}>
          {showForm ? "Cancel" : "New business"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {atBusinessLimit && !showForm && (
        <Alert tone="warning">
          You've used {usage!.businessCount} of {usage!.maxBusinesses} businesses included on your plan. Upgrade to
          add another.
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
              <code className="rounded bg-background px-2 py-1 font-mono text-sm text-foreground">
                {revealedPassword.password}
              </code>
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

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Create a business</h2>
          <p className="mb-3 text-sm text-muted">
            Creates the business and its first location. Choose how the owner gets access below.
          </p>
          <fieldset className="mb-3 flex flex-col gap-2 rounded-lg border border-border p-3 text-sm sm:flex-row sm:gap-4">
            <legend className="px-1 text-xs font-medium uppercase tracking-wide text-muted">Owner access</legend>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="provisioningMode"
                checked={provisioningMode === "invite"}
                onChange={() => setProvisioningMode("invite")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Send invitation</span>
                <br />
                <span className="text-muted">Email the owner a secure link to set their own password.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="provisioningMode"
                checked={provisioningMode === "direct"}
                onChange={() => setProvisioningMode("direct")}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground">Create owner access now</span>
                <br />
                <span className="text-muted">
                  Get a one-time temporary password to relay to the owner directly. They must set their own password
                  before using the account.
                </span>
              </span>
            </label>
          </fieldset>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Business name
              <input
                required
                value={draft.businessName}
                onChange={(e) => setDraft({ ...draft, businessName: e.target.value })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Business slug
              <input
                required
                value={draft.businessSlug}
                onChange={(e) => setDraft({ ...draft, businessSlug: e.target.value.toLowerCase() })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              First location name
              <input
                required
                value={draft.locationName}
                onChange={(e) => setDraft({ ...draft, locationName: e.target.value })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Location slug
              <input
                required
                value={draft.locationSlug}
                onChange={(e) => setDraft({ ...draft, locationSlug: e.target.value.toLowerCase() })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Owner full name
              <input
                required
                value={draft.ownerName}
                onChange={(e) => setDraft({ ...draft, ownerName: e.target.value })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Owner email
              <input
                required
                type="email"
                value={draft.ownerEmail}
                onChange={(e) => setDraft({ ...draft, ownerEmail: e.target.value })}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <Button type="submit" size="sm" disabled={creating || atBusinessLimit} className="self-start sm:col-span-2">
              {creating
                ? "Creating..."
                : provisioningMode === "direct"
                  ? "Create business & owner access"
                  : "Create business & invite owner"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="text-muted">Loading businesses...</p>
      ) : result && result.items.length === 0 ? (
        <EmptyState icon={<IconStore className="h-6 w-6" />} title="No businesses yet" description="Create the first one above." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Business</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Locations</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Subscription</th>
                <th className="py-2 pr-3 font-medium">Domain</th>
                <th className="py-2 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result?.items.map((b) => (
                <tr key={b.id}>
                  <td className="py-2.5 pr-3 font-medium text-foreground">{b.name}</td>
                  <td className="py-2.5 pr-3 text-muted">
                    {b.ownerName ?? "—"}
                    {b.ownerInvitePending && (
                      <Badge tone="warning" className="ml-1.5">
                        Invite pending
                      </Badge>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-foreground">{b.locationCount}</td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={b.status === "active" ? "success" : "neutral"}>{b.status}</Badge>
                  </td>
                  <td className="py-2.5 pr-3 text-muted">{b.subscriptionStatus ?? "—"}</td>
                  <td className="py-2.5 pr-3 text-muted">{b.domainCount > 0 ? "Configured" : "—"}</td>
                  <td className="py-2.5 pr-3 text-right">
                    <Link to={`/agency/businesses/${b.id}`} className="text-sm font-medium text-primary hover:underline">
                      Manage
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hasNextPage={result.hasNextPage}
          hasPreviousPage={result.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${result.total} business${result.total === 1 ? "" : "es"}`}
        />
      )}
    </div>
  );
}
