import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Paginated, RestaurantAvailability } from "@restaurant/types";
import { Alert, Badge, Card, EmptyState, Pagination } from "@restaurant/ui";
import { describeAvailability } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { IconPin } from "../components/icons";

interface AgencyLocationSummary {
  id: string;
  name: string;
  slug: string;
  city?: string;
  status: string;
  businessId: string;
  businessName: string;
  timezone: string;
  availability: RestaurantAvailability;
}

const PAGE_SIZE = 20;

/**
 * Portal UX phase — the one place this phase adds a genuinely new (small, read-only) backend
 * capability: GET /agencies/:agencyId/locations, a flat cross-client location list. Previously,
 * locations were only visible nested inside each client's own detail page
 * (AgencyBusinessDetailPage) — there was no "every location I manage" view. `availability` reuses
 * the existing Phase 51 computeAvailability()/describeAvailability() — not a second engine.
 */
export function AgencyLocationsPage() {
  const { activeAgencyId } = useAgency();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paginated<AgencyLocationSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAgencyId) return;
    setLoading(true);
    apiClient
      .request<Paginated<AgencyLocationSummary>>(`/agencies/${activeAgencyId}/locations?page=${page}&limit=${PAGE_SIZE}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [activeAgencyId, page]);

  if (!activeAgencyId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Locations</h1>
        <p className="text-sm text-muted">Every location across every client this agency manages.</p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {loading ? (
        <p className="text-muted">Loading locations...</p>
      ) : result && result.items.length === 0 ? (
        <EmptyState icon={<IconPin className="h-6 w-6" />} title="No locations yet" description="Locations appear here once a client creates one." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Client</th>
                <th className="px-4 py-2.5 font-medium">City</th>
                <th className="px-4 py-2.5 font-medium">Timezone</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Ordering</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {result?.items.map((l) => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{l.name}</td>
                  <td className="px-4 py-2.5 text-muted">
                    <Link to={`/agency/businesses/${l.businessId}`} className="font-medium text-primary hover:underline">
                      {l.businessName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted">{l.city ?? "—"}</td>
                  <td className="px-4 py-2.5 text-muted">{l.timezone}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={l.status === "active" ? "success" : "neutral"}>{l.status}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <Badge tone={l.availability.status === "open" ? "success" : l.availability.status === "paused" ? "warning" : "neutral"}>
                      {describeAvailability(l.availability, l.timezone)}
                    </Badge>
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
          totalLabel={`${result.total} location${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
