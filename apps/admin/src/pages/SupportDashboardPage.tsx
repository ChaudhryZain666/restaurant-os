import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, type SupportTicket } from "@restaurant/types";
import { Badge, Card, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { TICKET_PRIORITY_LABELS, TICKET_PRIORITY_TONE, TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from "../lib/ticketStatus";

interface SupportAnalytics {
  open: number;
  inProgress: number;
  waitingCustomer: number;
  resolved: number;
  highPriority: number;
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <span className="font-heading text-2xl font-semibold text-foreground">{value}</span>
    </Card>
  );
}

export function SupportDashboardPage() {
  const [analytics, setAnalytics] = useState<SupportAnalytics | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [category, setCategory] = useState("");

  useEffect(() => {
    apiClient
      .request<{ analytics: SupportAnalytics }>("/support/admin/analytics")
      .then((data) => setAnalytics(data.analytics))
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (category) params.set("category", category);
    apiClient
      .request<{ tickets: SupportTicket[] }>(`/support/admin/tickets?${params.toString()}`)
      .then((data) => setTickets(data.tickets))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [status, priority, category]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Support</h1>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {analytics ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <SummaryCard label="Open" value={analytics.open} />
          <SummaryCard label="In progress" value={analytics.inProgress} />
          <SummaryCard label="Waiting" value={analytics.waitingCustomer} />
          <SummaryCard label="High priority" value={analytics.highPriority} />
          <SummaryCard label="Resolved" value={analytics.resolved} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground">
          <option value="">All statuses</option>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground">
          <option value="">All priorities</option>
          {TICKET_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {TICKET_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground">
          <option value="">All categories</option>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Skeleton className="h-40 w-full" />
      ) : tickets.length === 0 ? (
        <Card className="text-center text-muted">No tickets match these filters.</Card>
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th className="py-2 font-medium">Ticket</th>
              <th className="font-medium">From</th>
              <th className="font-medium">Restaurant</th>
              <th className="font-medium">Category</th>
              <th className="font-medium">Priority</th>
              <th className="font-medium">Status</th>
              <th className="font-medium">Updated</th>
            </tr>
          </thead>
          <tbody className="text-foreground/80">
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-border transition-colors duration-fast hover:bg-black/[0.02]">
                <td className="py-2">
                  <Link to={`/platform/support/tickets/${t.id}`} className="text-foreground underline decoration-dotted">
                    {t.subject}
                  </Link>
                  <div className="text-xs text-muted">{t.ticketNumber}</div>
                </td>
                <td>{t.createdByName ?? "—"}</td>
                <td>{t.restaurantName ?? "—"}</td>
                <td className="capitalize">{t.category.replace(/_/g, " ")}</td>
                <td>
                  <Badge tone={TICKET_PRIORITY_TONE[t.priority]}>{TICKET_PRIORITY_LABELS[t.priority]}</Badge>
                </td>
                <td>
                  <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                </td>
                <td>{new Date(t.updatedAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
