import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Restaurant, RestaurantAvailability, RestaurantReadiness } from "@restaurant/types";
import { Alert, Badge, Card } from "@restaurant/ui";
import { describeAvailability } from "@restaurant/utils";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { IconStore } from "../components/icons";

interface LocationOwner {
  name: string;
  email: string;
  invitePending: boolean;
}

interface AgencyLocationDetailResponse {
  business: { id: string; name: string };
  location: Restaurant;
  owner: LocationOwner | null;
  availability: RestaurantAvailability;
  readiness: RestaurantReadiness;
  storefrontUrl: string;
}

/**
 * Phase 58, Section 14 — the location drill-down AgencyLocationsPage's flat list previously had no
 * page to link into. Deliberately portfolio visibility only, NOT a second Restaurant Owner Portal
 * (Section 14's own explicit warning): identity, availability, setup readiness, owner relationship,
 * a storefront link — no menu/order/staff management surfaces, which stay the Owner Portal's job.
 */
export function AgencyLocationDetailPage() {
  const { locationId } = useParams<{ locationId: string }>();
  const { activeAgencyId } = useAgency();
  const [data, setData] = useState<AgencyLocationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeAgencyId || !locationId) return;
    setLoading(true);
    setError(null);
    apiClient
      .request<AgencyLocationDetailResponse>(`/agencies/${activeAgencyId}/locations/${locationId}`)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [activeAgencyId, locationId]);

  if (!activeAgencyId || !locationId) return null;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/agency/locations" className="text-sm font-medium text-muted hover:text-foreground">
        ← Back to locations
      </Link>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {loading ? (
        <p className="text-muted">Loading location...</p>
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                <Link to={`/agency/businesses/${data.business.id}`} className="hover:underline">
                  {data.business.name}
                </Link>
              </p>
              <h1 className="font-heading text-2xl font-semibold text-foreground">{data.location.name}</h1>
              <p className="text-sm text-muted">/{data.location.slug}</p>
            </div>
            <a href={data.storefrontUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary hover:underline">
              View storefront ↗
            </a>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col gap-2">
              <h2 className="font-heading text-sm font-medium text-foreground">Status</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={data.location.status === "active" ? "success" : "neutral"}>{data.location.status}</Badge>
                <Badge tone={data.availability.status === "open" ? "success" : data.availability.status === "paused" ? "warning" : "neutral"}>
                  {describeAvailability(data.availability, data.location.settings.timezone)}
                </Badge>
              </div>
              <p className="text-xs text-muted">{data.location.settings.timezone}</p>
            </Card>

            <Card className="flex flex-col gap-2">
              <h2 className="font-heading text-sm font-medium text-foreground">Setup readiness</h2>
              <Badge tone={data.readiness.ready ? "success" : "warning"}>{data.readiness.ready ? "Ready" : "Not ready yet"}</Badge>
              <ul className="flex flex-col gap-1 text-xs">
                {data.readiness.checks.map((c) => (
                  <li key={c.key} className={c.complete ? "text-foreground" : "text-muted"}>
                    {c.complete ? "✓" : "○"} {c.label}
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <Card className="flex flex-col gap-2">
            <h2 className="font-heading text-sm font-medium text-foreground">Owner</h2>
            {data.owner ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <IconStore className="h-4 w-4 shrink-0 text-muted" />
                <span className="font-medium text-foreground">{data.owner.name}</span>
                <span className="text-muted">{data.owner.email}</span>
                {data.owner.invitePending && <Badge tone="warning">Invite pending</Badge>}
              </div>
            ) : (
              <p className="text-sm text-muted">No owner account found.</p>
            )}
            <Link to={`/agency/businesses/${data.business.id}`} className="self-start text-xs font-medium text-primary hover:underline">
              Manage owner from the client page →
            </Link>
          </Card>
        </>
      ) : null}
    </div>
  );
}
