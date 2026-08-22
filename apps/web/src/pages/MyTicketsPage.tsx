import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SupportTicket } from "@restaurant/types";
import { Badge, Button, Card, EmptyState, Reveal, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from "../lib/ticketStatus";
import { useNoIndex } from "../hooks/useNoIndex";

function TicketGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z" strokeLinejoin="round" />
    </svg>
  );
}

export function MyTicketsPage() {
  useNoIndex();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ tickets: SupportTicket[] }>("/support/tickets/mine")
      .then((data) => setTickets(data.tickets))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="mx-auto max-w-2xl text-danger">
        {error}
      </p>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-semibold text-foreground">My support tickets</h1>
        <Link to="/support/tickets/new">
          <Button size="sm">New ticket</Button>
        </Link>
      </div>

      {tickets.length === 0 ? (
        <EmptyState icon={<TicketGlyph className="h-6 w-6" />} title="No tickets yet" description="You haven't contacted support yet." />
      ) : (
        <ul className="flex flex-col gap-3">
          {tickets.map((t, i) => (
            <Reveal as="li" index={i} key={t.id}>
              <Link to={`/support/tickets/${t.id}`}>
                <Card className="flex flex-col gap-1 transition-shadow duration-normal hover:shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{t.subject}</span>
                    <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                  </div>
                  <span className="text-xs text-muted">
                    {t.ticketNumber} · {new Date(t.createdAt).toLocaleDateString()}
                  </span>
                </Card>
              </Link>
            </Reveal>
          ))}
        </ul>
      )}
    </div>
  );
}
