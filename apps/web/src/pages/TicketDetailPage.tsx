import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { SupportMessage, SupportTicket } from "@restaurant/types";
import { Alert, Badge, Button, Card, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from "../lib/ticketStatus";
import { useNoIndex } from "../hooks/useNoIndex";

export function TicketDetailPage() {
  useNoIndex();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
      await apiClient.request(`/support/tickets/${id}/messages`, { method: "POST", body: { content: reply } });
      setReply("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function confirmResolution() {
    setConfirming(true);
    setError(null);
    try {
      await apiClient.request(`/support/tickets/${id}/confirm-resolution`, { method: "PATCH" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error && !ticket) {
    return (
      <Alert tone="danger" role="alert" className="mx-auto max-w-2xl">
        {error}
      </Alert>
    );
  }

  if (!ticket) return null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-xl font-semibold text-foreground">{ticket.subject}</h1>
          <p className="text-xs text-muted">{ticket.ticketNumber}</p>
        </div>
        <Badge tone={TICKET_STATUS_TONE[ticket.status]}>{TICKET_STATUS_LABELS[ticket.status]}</Badge>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <Card className="flex flex-col gap-3">
        {messages.map((m) => {
          const isMine = m.authorId === user?.id;
          return (
            <div key={m.id} className={`animate-fade-up flex flex-col ${isMine ? "items-end" : "items-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                  isMine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-black/[0.05] text-foreground"
                }`}
              >
                {m.content}
              </div>
              <span className="mt-1 text-xs text-muted">
                {m.authorType === "support" ? "Support" : "You"} · {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
          );
        })}
      </Card>

      {ticket.status === "resolved" && (
        <Alert tone="success" className="animate-scale-in flex-wrap items-center justify-between gap-2">
          <span>Marked resolved. Was your issue fixed?</span>
          <Button size="sm" onClick={confirmResolution} disabled={confirming}>
            {confirming ? "Closing..." : "Yes, close this ticket"}
          </Button>
        </Alert>
      )}

      {ticket.status !== "closed" ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            placeholder="Write a reply..."
            className="rounded-lg border border-border bg-surface px-3 py-2"
          />
          <Button onClick={sendReply} disabled={sending || !reply.trim()} className="self-end">
            {sending ? "Sending..." : "Send reply"}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted">This ticket is closed.</p>
      )}
    </div>
  );
}
