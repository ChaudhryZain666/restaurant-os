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
}

const PAGE_SIZE = 20;

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [creating, setCreating] = useState(false);

  async function reload() {
    if (!activeAgencyId) return;
    const data = await apiClient.request<Paginated<AgencyBusinessSummary>>(
      `/agencies/${activeAgencyId}/businesses?page=${page}&limit=${PAGE_SIZE}`
    );
    setResult(data);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId, page]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/businesses`, { method: "POST", body: draft });
      setDraft(emptyDraft());
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
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New business"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Create a business</h2>
          <p className="mb-3 text-sm text-muted">
            Creates the business, its first location, and sends the owner an invitation to set up and run it.
          </p>
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
            <Button type="submit" size="sm" disabled={creating} className="self-start sm:col-span-2">
              {creating ? "Creating..." : "Create business & invite owner"}
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
