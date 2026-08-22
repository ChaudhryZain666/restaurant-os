import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { TICKET_PRIORITIES, TICKET_STATUSES, type SupportMessage, type SupportTicket, type TicketPriority, type TicketStatus } from "@restaurant/types";
import { Badge, Button, Card, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { TICKET_PRIORITY_LABELS, TICKET_STATUS_LABELS } from "../lib/ticketStatus";

export function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);

  function reload() {
    return Promise.all([
      apiClient.request<{ ticket: SupportTicket }>(`/support/tickets/${id}`),
      apiClient.request<{ messages: SupportMessage[] }>(`/support/tickets/${id}/messages`),
    ]).then(([t, m]) => {
      setTicket(t.ticket);
      setMessages(m.messages);
    });
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function sendReply() {
    if (!reply.trim()) return;
    setSending(true);
    setError(null);
    try {
      await apiClient.request(`/support/tickets/${id}/messages`, {
        method: "POST",
        body: { content: reply, isInternal },
      });
      setReply("");
      setIsInternal(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: TicketStatus) {
    setError(null);
    try {
      await apiClient.request(`/support/admin/tickets/${id}/status`, { method: "PATCH", body: { status } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setPriority(priority: TicketPriority) {
    setError(null);
    try {
      await apiClient.request(`/support/admin/tickets/${id}/priority`, { method: "PATCH", body: { priority } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function setAssignment(assignedTo: string | null) {
    setError(null);
    try {
      await apiClient.request(`/support/admin/tickets/${id}/assign`, { method: "PATCH", body: { assignedTo } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );
  }

  if (!ticket) return null;

  const isAssignedToMe = ticket.assignedTo === user?.id;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">{ticket.subject}</h1>
          <p className="text-xs text-muted">{ticket.ticketNumber}</p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <Card className="flex flex-col gap-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-lg px-3 py-2 text-sm ${
                m.isInternal ? "border border-warning/30 bg-warning/10" : "bg-black/[0.04]"
              }`}
            >
              {m.isInternal && <Badge tone="warning">Internal note</Badge>}
              <p className="mt-1 whitespace-pre-wrap text-foreground">{m.content}</p>
              <span className="mt-1 block text-xs text-muted">
                {m.authorType === "support" ? "Support" : "Customer"} · {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </Card>

        <div className="flex flex-col gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Write a reply or internal note..."
            className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
              Internal note (never visible to the customer)
            </label>
            <Button size="sm" onClick={sendReply} disabled={sending || !reply.trim()}>
              {sending ? "Sending..." : isInternal ? "Add note" : "Send reply"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card className="flex flex-col gap-2">
          <h2 className="font-medium text-foreground">Controls</h2>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Status
            <select
              value={ticket.status}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            >
              {TICKET_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TICKET_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Priority
            <select
              value={ticket.priority}
              onChange={(e) => setPriority(e.target.value as TicketPriority)}
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted">
            Assignment
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground">
                {ticket.assignedToName ?? (ticket.assignedTo ? "Assigned" : "Unassigned")}
              </span>
              {isAssignedToMe ? (
                <Button size="sm" variant="ghost" onClick={() => setAssignment(null)}>
                  Unassign
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setAssignment(user!.id)}>
                  Assign to me
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-2 text-sm">
          <h2 className="font-medium text-foreground">Context</h2>
          <div className="flex justify-between">
            <span className="text-muted">Customer</span>
            <span>{ticket.createdByName ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Email</span>
            <span>{ticket.createdByEmail ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Restaurant</span>
            <span>{ticket.restaurantName ?? "None"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Agency</span>
            {/* No Agency model exists yet anywhere in this codebase — always "Direct" today. See
                docs/support-architecture.md for the integration boundary this reflects. */}
            <span>Direct (no agency)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Category</span>
            <span className="capitalize">{ticket.category.replace(/_/g, " ")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Source</span>
            <span className="capitalize">{ticket.source.replace(/_/g, " ")}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">App</span>
            <span>{ticket.context?.app ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Page</span>
            <span>{ticket.context?.route ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Created</span>
            <span>{new Date(ticket.createdAt).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">Last activity</span>
            <span>{new Date(ticket.updatedAt).toLocaleString()}</span>
          </div>
        </Card>
      </div>
    </div>
  );
}
