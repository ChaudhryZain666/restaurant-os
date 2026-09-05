import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { SupportTicket } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { TICKET_STATUS_LABELS, TICKET_STATUS_TONE } from "../lib/ticketStatus";
import { IconHeadset } from "../components/icons";
import { ScopeBadge } from "../components/ScopeBadge";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Portal UX safety phase — this page used to only ever list tickets that already existed, with no
 * way to create one; several other pages (e.g. DashboardPage's suspended-restaurant banner) link
 * here as "Contact support" and found nothing they could actually do. Wired to the same
 * POST /support/tickets the customer-facing help widget already uses (support.routes.ts) — no new
 * support architecture, just a real entry point into the existing one.
 */
export function RestaurantSupportPage() {
  const restaurantId = useActiveLocationId();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .request<{ tickets: SupportTicket[] }>(`/restaurants/${restaurantId}/support/tickets`)
      .then((data) => setTickets(data.tickets))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const { ticket } = await apiClient.request<{ ticket: SupportTicket }>("/support/tickets", {
        method: "POST",
        body: { subject, description: message, context: { app: "admin", route: "/support" } },
      });
      // Straight into the new ticket, same "created -> immediately open it" pattern the rest of
      // the app already uses (e.g. Menu's create-item panel) — the list itself will show it too
      // the next time this page is reached via the "Back to support" link.
      navigate(`/support/${ticket.id}`);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p className="text-muted">Loading...</p>;
  if (error)
    return (
      <p role="alert" className="text-danger">
        {error}
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold text-foreground">Support</h1>
            <ScopeBadge scope="location" />
          </div>
          <p className="text-sm text-muted">Your restaurant's support requests, and platform support's replies.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Contact support"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Contact support</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Subject
              <input
                required
                minLength={3}
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's this about?"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Message
              <textarea
                required
                minLength={1}
                maxLength={5000}
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe what's happening — we'll get back to you here."
                className={inputClass}
              />
            </label>
            {submitError && (
              <Alert tone="danger" role="alert">
                {submitError}
              </Alert>
            )}
            <Button type="submit" size="sm" disabled={submitting} className="self-start">
              {submitting ? "Sending..." : "Send"}
            </Button>
          </form>
        </Card>
      )}

      {tickets.length === 0 ? (
        <EmptyState
          icon={<IconHeadset className="h-6 w-6" />}
          title="No support tickets yet"
          description="Need help with something? Contact support and we'll help you get it sorted."
          action={
            !showForm ? (
              <Button size="sm" onClick={() => setShowForm(true)}>
                Contact support
              </Button>
            ) : undefined
          }
        />
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
