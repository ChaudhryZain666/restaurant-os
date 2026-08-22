import { useEffect, useState } from "react";
import type { AuditAction, AuditLogEntry, AuditTargetType, Paginated } from "@restaurant/types";
import { AUDIT_ACTIONS } from "@restaurant/types";
import { Alert, Card, EmptyState, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { AUDIT_ACTION_LABELS } from "../lib/auditLog";

const PAGE_SIZE = 30;

const TARGET_TYPE_OPTIONS: Array<AuditTargetType | "all"> = ["all", "order", "payment", "restaurant", "user"];
const TARGET_TYPE_LABELS: Record<AuditTargetType, string> = {
  order: "Orders",
  payment: "Payments",
  restaurant: "Restaurant",
  user: "Users",
};

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/** Small, action-specific context stored on the entry — rendered as plain "key: value" pairs
 *  rather than pretty-printed JSON, since it's always a flat, short object (see AuditLog.ts's
 *  metadata field: "never raw payment amounts beyond what's already visible elsewhere, never
 *  card/provider secrets"). */
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

export function AuditLogPage() {
  const restaurantId = useActiveLocationId();
  const [page, setPage] = useState(1);
  const [targetType, setTargetType] = useState<AuditTargetType | "all">("all");
  const [action, setAction] = useState<AuditAction | "all">("all");
  const [actorUserId, setActorUserId] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState<Paginated<AuditLogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Built up from actors actually seen across fetched pages this session — a lightweight way to
  // offer an actor filter without a dedicated "list distinct actors" endpoint; every name it
  // could ever show is one a real audit entry has already surfaced.
  const [knownActors, setKnownActors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    setPage(1);
  }, [targetType, action, actorUserId, startDate, endDate]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (targetType !== "all") params.set("targetType", targetType);
    if (action !== "all") params.set("action", action);
    if (actorUserId !== "all") params.set("actorUserId", actorUserId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    apiClient
      .request<Paginated<AuditLogEntry>>(`/restaurants/${restaurantId}/audit-log?${params}`)
      .then((data) => {
        setResult(data);
        setKnownActors((prev) => {
          const next = new Map(prev);
          for (const entry of data.items) next.set(entry.actorUserId, entry.actorName ?? "Unknown");
          return next;
        });
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId, page, targetType, action, actorUserId, startDate, endDate]);

  const entries = result?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Audit log</h1>
        <p className="text-sm text-muted">A record of status changes, cancellations, refunds, and staff/restaurant changes.</p>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Target
          <select value={targetType} onChange={(e) => setTargetType(e.target.value as AuditTargetType | "all")} className={inputClass}>
            {TARGET_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "All activity" : TARGET_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Action
          <select value={action} onChange={(e) => setAction(e.target.value as AuditAction | "all")} className={inputClass}>
            <option value="all">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          Actor
          <select value={actorUserId} onChange={(e) => setActorUserId(e.target.value)} className={inputClass}>
            <option value="all">All actors</option>
            {[...knownActors.entries()].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted">
          From
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          To
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </label>
        {(targetType !== "all" || action !== "all" || actorUserId !== "all" || startDate || endDate) && (
          <button
            type="button"
            onClick={() => {
              setTargetType("all");
              setAction("all");
              setActorUserId("all");
              setStartDate("");
              setEndDate("");
            }}
            className="text-sm font-medium text-foreground/70 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-muted">Loading audit log...</p>
      ) : entries.length === 0 ? (
        <EmptyState title="No activity found" description="No audit events match these filters." />
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
                  <td className="px-4 py-2.5 font-medium text-foreground">{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</td>
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
