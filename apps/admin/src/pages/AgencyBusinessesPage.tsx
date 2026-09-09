import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Paginated } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { useAgencyPermission } from "../hooks/useAgencyPermission";
import { IconStore } from "../components/icons";
import { businessJourneyStage, JOURNEY_STAGE_LABEL, JOURNEY_STAGE_TONE } from "../lib/agencyJourney";
import { ClientProvisioningWizard } from "../components/ClientProvisioningWizard";

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

const STATUS_FILTERS = ["all", "live", "onboarding", "owner_pending", "inactive", "multi_location"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: "All clients",
  live: "Live",
  onboarding: "Onboarding",
  owner_pending: "Awaiting owner acceptance",
  inactive: "Inactive",
  multi_location: "Multiple locations",
};

const SORT_OPTIONS = ["createdAt", "name", "locationCount"] as const;
type SortField = (typeof SORT_OPTIONS)[number];
const SORT_LABEL: Record<SortField, string> = { createdAt: "Date created", name: "Name", locationCount: "Locations" };

/**
 * Phase 25 — list + create. Phase 26 added the "Manage" link into AgencyBusinessDetailPage, which
 * is where the actual "enter this business's operational admin" action lives (see that page's doc
 * comment) — this list itself stays a summary view, not the entry point.
 *
 * Phase 58 — server-side search/filter/sort (Sections 7-9), mirroring PlatformRestaurantsPage.tsx's
 * exact debounce/query-param pattern so this list scales to hundreds of clients without ever
 * loading them all into the browser. `status` filter values mirror agencyJourney.ts's real,
 * already-derived lifecycle states — see packages/validation/src/agency.ts's doc comment for why
 * these, not raw Business.status, are what's offered.
 *
 * Phase 59 — "New client" now opens ClientProvisioningWizard's guided Client -> Restaurant ->
 * Commercial -> Owner -> Review flow instead of one flat form; on success this page immediately
 * navigates to the new client's detail page (Section 7's "land on a useful Client Detail view"),
 * carrying the one-time revealed password / any commercial-terms save error via router state rather
 * than duplicating that display logic here.
 */
export function AgencyBusinessesPage() {
  const { activeAgencyId } = useAgency();
  const navigate = useNavigate();
  const canManage = useAgencyPermission("agency.businesses.manage");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortField>("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [result, setResult] = useState<Paginated<AgencyBusinessSummary> | null>(null);
  const [usage, setUsage] = useState<{ maxBusinesses: number; businessCount: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter, sort, order]);

  async function reload() {
    if (!activeAgencyId) return;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), sort, order });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    const [data, entitlementsRes] = await Promise.all([
      apiClient.request<Paginated<AgencyBusinessSummary>>(`/agencies/${activeAgencyId}/businesses?${params}`),
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
  }, [activeAgencyId, page, debouncedSearch, statusFilter, sort, order]);

  // Phase 39 — a pre-check so the "New business" action can be disabled and explained at the
  // limit, instead of only failing with a 409 after the form is filled out. reserveBusinessSlot
  // (agencyEntitlement.service.ts) remains the real, atomic, server-side guard — this is convenience
  // only, and can be momentarily stale under concurrent creation, exactly like canCreateAnotherBusiness
  // always has been.
  const atBusinessLimit = usage !== null && usage.businessCount >= usage.maxBusinesses;

  function handleClientCreated(result: { businessId: string; ownerTemporaryPassword?: string; ownerEmail: string; commercialTermsError?: string }) {
    setShowForm(false);
    navigate(`/agency/businesses/${result.businessId}`, {
      state: {
        revealedPassword: result.ownerTemporaryPassword ? { ownerEmail: result.ownerEmail, password: result.ownerTemporaryPassword } : undefined,
        commercialTermsError: result.commercialTermsError,
      },
    });
  }

  if (!activeAgencyId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Clients</h1>
          <p className="text-sm text-muted">The restaurants this agency provisions and supports.</p>
        </div>
        {canManage && !showForm && (
          <Button size="sm" onClick={() => setShowForm(true)} disabled={atBusinessLimit}>
            New client
          </Button>
        )}
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {!canManage && (
        <Alert tone="neutral">Only an agency owner or admin can create a new client.</Alert>
      )}

      {atBusinessLimit && !showForm && canManage && (
        <Alert tone="warning">
          You've used {usage!.businessCount} of {usage!.maxBusinesses} clients included on your plan. Upgrade to add
          another.
        </Alert>
      )}

      {showForm && canManage && activeAgencyId && (
        <ClientProvisioningWizard
          agencyId={activeAgencyId}
          atBusinessLimit={atBusinessLimit}
          onCreated={handleClientCreated}
          onCancel={() => setShowForm(false)}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client, owner name, or owner email..."
          className="max-w-sm flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f} value={f}>
              {STATUS_FILTER_LABEL[f]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortField)}
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))}
          aria-label={order === "asc" ? "Sort ascending" : "Sort descending"}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground hover:bg-black/[0.03]"
        >
          {order === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
      </div>

      {loading ? (
        <p className="text-muted">Loading clients...</p>
      ) : result && result.items.length === 0 ? (
        debouncedSearch || statusFilter !== "all" ? (
          <EmptyState icon={<IconStore className="h-6 w-6" />} title="No clients match these filters" description="Try a different search term or filter." />
        ) : (
          <EmptyState icon={<IconStore className="h-6 w-6" />} title="No clients yet" description="Create the first one above." />
        )
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3 font-medium">Client</th>
                <th className="py-2 pr-3 font-medium">Owner</th>
                <th className="py-2 pr-3 font-medium">Locations</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Progress</th>
                <th className="py-2 pr-3 font-medium">Subscription</th>
                <th className="py-2 pr-3 font-medium">Domain</th>
                <th className="py-2 pr-3 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result?.items.map((b) => (
                <tr key={b.id}>
                  <td className="py-2.5 pr-3 font-medium text-foreground">
                    <Link to={`/agency/businesses/${b.id}`} className="hover:underline">
                      {b.name}
                    </Link>
                  </td>
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
                  <td className="py-2.5 pr-3">
                    {(() => {
                      const stage = businessJourneyStage(b);
                      return <Badge tone={JOURNEY_STAGE_TONE[stage]}>{JOURNEY_STAGE_LABEL[stage]}</Badge>;
                    })()}
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
          totalLabel={`${result.total} client${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
