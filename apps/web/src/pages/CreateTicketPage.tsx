import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { TICKET_CATEGORIES, type SupportTicket, type TicketCategory } from "@restaurant/types";
import { Alert, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useRestaurant } from "../context/RestaurantContext";
import { useNoIndex } from "../hooks/useNoIndex";

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  menu: "Menu",
  orders: "Orders",
  billing: "Billing",
  account: "Account",
  technical: "Technical issue",
  data_recovery: "Accidentally deleted something",
  other: "Other",
};

const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

export function CreateTicketPage() {
  useNoIndex();
  const { user } = useAuth();
  const { restaurant, supportIdentity } = useRestaurant();
  const navigate = useNavigate();

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    navigate("/login");
    return null;
  }

  async function submit() {
    if (!subject.trim() || !description.trim()) {
      setError("Please fill in a subject and description");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { ticket } = await apiClient.request<{ ticket: SupportTicket }>("/support/tickets", {
        method: "POST",
        body: {
          subject,
          description,
          category,
          restaurantId: restaurant?.id,
          context: { app: "web", route: "/support/tickets/new" },
        },
      });
      navigate(`/support/tickets/${ticket.id}`);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <Card className="animate-scale-in mx-auto flex max-w-xl flex-col gap-3">
      <h1 className="font-heading text-xl font-semibold text-foreground">Contact {supportIdentity?.name ?? "support"}</h1>

      <label className="flex flex-col gap-1 text-sm">
        What's it about?
        <select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} className={inputClass}>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Subject
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Briefly summarize your issue"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Tell us more
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          placeholder="What happened, and what were you trying to do?"
          className={inputClass}
        />
      </label>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <Button onClick={submit} disabled={submitting} className="self-start">
        {submitting ? "Sending..." : "Submit ticket"}
      </Button>
    </Card>
  );
}
