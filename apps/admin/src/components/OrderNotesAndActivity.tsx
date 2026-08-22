import { useEffect, useState } from "react";
import type { AuditLogEntry, Order, Paginated } from "@restaurant/types";
import { roleHasPermission } from "@restaurant/types";
import { Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { AUDIT_ACTION_LABELS } from "../lib/auditLog";

/**
 * Internal note editor (staff-only field — see order.controller.ts's stripInternalFields for why
 * this can never reach a customer) plus a lazy-loaded activity feed sourced from AuditLog. Both
 * only fetch/render when the card is actually expanded — this component only mounts then.
 */
export function OrderNotesAndActivity({ order }: { order: Order }) {
  const { user } = useAuth();
  const canReadAudit = user ? roleHasPermission(user.role, "restaurant.audit.read") : false;

  const [note, setNote] = useState(order.internalNote ?? "");
  const [savingNote, setSavingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const [activity, setActivity] = useState<AuditLogEntry[] | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    setNote(order.internalNote ?? "");
  }, [order.internalNote]);

  async function saveNote() {
    setSavingNote(true);
    setNoteError(null);
    try {
      await apiClient.request(`/restaurants/${order.restaurantId}/orders/${order.id}/note`, {
        method: "PATCH",
        body: { internalNote: note },
      });
    } catch (err) {
      setNoteError((err as Error).message);
    } finally {
      setSavingNote(false);
    }
  }

  async function toggleActivity() {
    const opening = !activityOpen;
    setActivityOpen(opening);
    if (opening && activity === null) {
      setActivityLoading(true);
      try {
        const data = await apiClient.request<Paginated<AuditLogEntry>>(
          `/restaurants/${order.restaurantId}/audit-log?targetType=order&targetId=${order.id}&limit=50`
        );
        setActivity(data.items);
      } catch {
        setActivity([]);
      } finally {
        setActivityLoading(false);
      }
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <label className="flex flex-col gap-1">
        <span className="font-medium text-foreground/80">Internal note (staff only)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={2}
          placeholder="Not visible to the customer"
          className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={saveNote} disabled={savingNote || note === (order.internalNote ?? "")}>
          {savingNote ? "Saving..." : "Save note"}
        </Button>
        {noteError && <span className="text-danger">{noteError}</span>}
      </div>

      {canReadAudit && (
        <div>
          <button onClick={toggleActivity} className="font-medium text-foreground/70 hover:underline">
            {activityOpen ? "Hide activity" : "Show activity"}
          </button>
          {activityOpen && (
            <ul className="mt-1.5 flex flex-col gap-1">
              {activityLoading && <li>Loading...</li>}
              {activity?.length === 0 && <li>No recorded activity yet.</li>}
              {activity?.map((entry) => (
                <li key={entry.id}>
                  {AUDIT_ACTION_LABELS[entry.action] ?? entry.action} — {new Date(entry.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
