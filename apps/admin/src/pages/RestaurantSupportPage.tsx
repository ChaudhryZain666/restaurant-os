import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SupportTicket } from "@restaurant/types";
import { Badge, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from "../lib/ticketStatus";

/**
 * Restaurant staff can view and reply to their own restaurant's tickets (GET/POST
 * /support/tickets/:id... already grant that via getTicketAccess's isRestaurantStaff check —
 * see RestaurantTicketDetailPage), but status/priority/assignment stays platform-support-only:
 * no PATCH route exists for restaurant-scoped roles. Internal notes are never included in any
 * response this role can reach regardless: support.tickets.internal_notes is platform_admin-only.
 */
export function RestaurantSupportPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ tickets: SupportTicket[] }>(`/restaurants/${restaurantId}/support/tickets`)
      .then((data) => setTickets(data.tickets))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  if (loading) return <p className="text-muted">Loading...</p>;
  if (error)
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Support</h1>
      {tickets.length === 0 ? (
        <Card className="text-center text-muted">No support tickets yet.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/support/${t.id}`}>
                <Card className="flex items-center justify-between gap-2 transition-colors duration-fast hover:bg-black/[0.02]">
                  <div>
                    <p className="font-medium text-foreground">{t.subject}</p>
                    <p className="text-xs text-muted">
                      {t.ticketNumber} · {t.createdByName ?? "—"} · {new Date(t.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone={TICKET_STATUS_TONE[t.status]}>{TICKET_STATUS_LABELS[t.status]}</Badge>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
