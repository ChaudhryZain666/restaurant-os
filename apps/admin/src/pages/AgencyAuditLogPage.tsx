import { useEffect, useState } from "react";
import type { AgencyAuditAction, AgencyAuditLogEntry, AgencyAuditTargetType, Paginated } from "@restaurant/types";
import { AGENCY_AUDIT_ACTIONS } from "@restaurant/types";
import { Alert, Card, EmptyState, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";
import { AGENCY_AUDIT_ACTION_LABELS } from "../lib/agencyAuditLog";

const PAGE_SIZE = 30;

const TARGET_TYPE_OPTIONS: Array<AgencyAuditTargetType | "all"> = ["all", "agency", "agency_membership", "business", "subscription"];
const TARGET_TYPE_LABELS: Record<AgencyAuditTargetType, string> = {
  agency: "Agency",
  agency_membership: "Team",
  business: "Clients",
  subscription: "Subscription",
};

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

function MetadataSummary({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return (
    <span className="text-muted">
      {Object.entries(metadata)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(", ")}
    </span>
  );
}

/**
 * Portal UX phase — the agency-scoped counterpart to AuditLogPage.tsx, wired to the already-existing
 * GET /agencies/:agencyId/audit-log (agency.controller.ts's getAgencyAuditLog, live since Phase 25/28)
 * which previously had no frontend page or nav item at all. Same filter/pagination pattern as the
 * owner-side page, over the separate AgencyAuditLog collection (agency-level events, not
 * restaurant-scoped ones).
 */
export function AgencyAuditLogPage() {
  const { activeAgencyId } = useAgency();
  const [page, setPage] = useState(1);
  const [targetType, setTargetType] = useState<AgencyAuditTargetType | "all">("all");
  const [action, setAction] = useState<AgencyAuditAction | "all">("all");
  const [result, setResult] = useState<Paginated<AgencyAuditLogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [targetType, action]);

  useEffect(() => {
    if (!activeAgencyId) return;
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (targetType !== "all") params.set("targetType", targetType);
    if (action !== "all") params.set("action", action);
    apiClient
      .request<Paginated<AgencyAuditLogEntry>>(`/agencies/${activeAgencyId}/audit-log?${params}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [activeAgencyId, page, targetType, action]);

  if (!activeAgencyId) return null;

  const entries = result?.items ?? [];
  const filtersActive = targetType !== "all" || action !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Activity</h1>
        <p className="text-sm text-muted">A record of agency-level actions — team, clients, and your subscription.</p>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Target
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as AgencyAuditTargetType | "all")} className={inputClass}>
            {TARGET_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All activity" : TARGET_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Action
          <select value={action} onChange={(e) => setAction(e.target.value as AgencyAuditAction | "all")} className={inputClass}>
            <option value="all">All actions</option>
            {AGENCY_AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AGENCY_AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>

        {filtersActive && (
          <button
            type="button"
            onClick={() => {
              setTargetType("all");
              setAction("all");
            }}
            className="text-sm font-medium text-foreground/70 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-muted">Loading activity...</p>
      ) : entries.length === 0 ? (
        filtersActive ? (
          <EmptyState title="No matching activity" description="No activity matches these filters." />
        ) : (
          <EmptyState
            title="No activity yet"
            description="Actions like inviting team members, creating clients, and subscription changes will show up here as they happen."
          />
        )
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Action</th>
                <th className="px-4 py-2.5 font-medium">Actor</th>
                <th className="px-4 py-2.5 font-medium">Details</th>
                <th className="px-4 py-2.5 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2.5 font-medium text-foreground">{AGENCY_AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</td>
                  <td className="px-4 py-2.5 text-muted">
                    {entry.actorName ?? "Unknown"} <span className="text-xs">({entry.actorRole})</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    <MetadataSummary metadata={entry.metadata} />
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">{new Date(entry.createdAt).toLocaleString()}</td>
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
          totalLabel={`${result.total} event${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
