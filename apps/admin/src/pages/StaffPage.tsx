import { useEffect, useState, type FormEvent } from "react";
import type { StaffMember, UserRole } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId, useLocation as useActiveLocation } from "../context/LocationContext";
import { IconIdBadge } from "../components/icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STAFF_ROLES: UserRole[] = ["restaurant_manager", "restaurant_staff", "kitchen_staff"];

const ROLE_LABELS: Record<string, string> = {
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen staff",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  restaurant_manager: "Full operational access — menu, orders, analytics, tickets.",
  restaurant_staff: "Can view the menu and manage orders.",
  kitchen_staff: "Can view and update order status only.",
};

interface InviteDraft {
  name: string;
  email: string;
  role: UserRole;
  phone: string;
}

function emptyDraft(): InviteDraft {
  return { name: "", email: "", role: "restaurant_staff", phone: "" };
}

export function StaffPage() {
  const restaurantId = useActiveLocationId();
  const { locations } = useActiveLocation();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<InviteDraft>(emptyDraft());
  const [inviting, setInviting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState<string | null>(null);

  async function reload() {
    const { staff } = await apiClient.request<{ staff: StaffMember[] }>(`/restaurants/${restaurantId}/staff`);
    setStaff(staff);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      // phone is optional server-side (`.min(7).optional()`) — that only accepts the key being
      // ABSENT, not an empty string, which still fails the min-length check. Sending "" (this
      // form's default) rather than omitting the key entirely used to make every phone-less
      // invite fail with an opaque "Validation failed".
      await apiClient.request(`/restaurants/${restaurantId}/staff`, {
        method: "POST",
        body: { ...draft, phone: draft.phone || undefined },
      });
      setDraft(emptyDraft());
      setShowForm(false);
      setInviteSent(draft.email);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function toggleActive(member: StaffMember) {
    setError(null);
    setBusyId(member.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/staff/${member.id}`, {
        method: "PATCH",
        body: { isActive: !member.isActive },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function changeRole(member: StaffMember, role: UserRole) {
    setError(null);
    setBusyId(member.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/staff/${member.id}`, { method: "PATCH", body: { role } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  /** Phase 19 — only meaningful for restaurant_staff/kitchen_staff (managers get implicit
   *  business-wide access regardless of locationIds — see requireTenantMatch). Only rendered at
   *  all when the business has more than one location, so a single-location owner never sees
   *  this UI (nothing to assign). */
  async function toggleLocation(member: StaffMember, locationId: string) {
    setError(null);
    setBusyId(member.id);
    try {
      const current = member.locationIds ?? [];
      const next = current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId];
      await apiClient.request(`/restaurants/${restaurantId}/staff/${member.id}`, {
        method: "PATCH",
        body: { locationIds: next },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function resendInvite(member: StaffMember) {
    setError(null);
    setBusyId(member.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/staff/${member.id}/resend-invite`, { method: "POST" });
      setInviteSent(member.email);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-muted">Loading staff...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Staff</h1>
          <p className="text-sm text-muted">
            Give your team their own logins with the right level of access — no more sharing one owner account.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setInviteSent(null);
            setShowForm((v) => !v);
          }}
        >
          {showForm ? "Cancel" : "Add staff member"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {inviteSent && (
        <Alert tone="success">
          Invitation sent to <strong>{inviteSent}</strong>. They'll get an email with a link to set their own
          password.
        </Alert>
      )}

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">Add a staff member</h2>
          <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                type="email"
                required
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Phone (optional)
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              Role
              <select
                value={draft.role}
                onChange={(e) => setDraft({ ...draft, role: e.target.value as UserRole })}
                className={inputClass}
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{ROLE_DESCRIPTIONS[draft.role]}</span>
            </label>
            <p className="text-xs text-muted sm:col-span-2">
              They'll get an email with a link to set their own password — no password to share with them yourself.
            </p>
            <Button type="submit" size="sm" disabled={inviting} className="self-start sm:col-span-2">
              {inviting ? "Sending invite..." : "Send invite"}
            </Button>
          </form>
        </Card>
      )}

      {staff.length === 0 ? (
        <EmptyState
          icon={<IconIdBadge className="h-6 w-6" />}
          title="No staff accounts yet"
          description="Add a staff member to give them their own login instead of sharing your owner account."
        />
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {staff.map((member) => (
              <li key={member.id} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-xs font-semibold text-secondary-foreground">
                  {member.name[0]?.toUpperCase() ?? "?"}
                </span>
                <div className="min-w-[10rem] flex-1">
                  <p className="flex items-center gap-1.5 font-medium text-foreground">
                    {member.name}
                    {!member.isActive && <Badge tone="neutral">Deactivated</Badge>}
                    {member.isActive && member.invitePending && <Badge tone="warning">Invite pending</Badge>}
                  </p>
                  <p className="text-xs text-muted">
                    {member.email}
                    {member.phone ? ` · ${member.phone}` : ""}
                  </p>
                </div>
                <select
                  value={member.role}
                  disabled={busyId === member.id}
                  onChange={(e) => changeRole(member, e.target.value as UserRole)}
                  className={inputClass}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                {member.isActive && member.invitePending && (
                  <button
                    onClick={() => resendInvite(member)}
                    disabled={busyId === member.id}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Resend invite
                  </button>
                )}
                <button
                  onClick={() => toggleActive(member)}
                  disabled={busyId === member.id}
                  className={`text-sm font-medium hover:underline ${member.isActive ? "text-danger" : "text-primary"}`}
                >
                  {member.isActive ? "Deactivate" : "Reactivate"}
                </button>
              </div>
              {/* Phase 19 — only shown once there's an actual choice to make (>1 location) and
                  only for roles that don't already get implicit business-wide access. A manager
                  covers every location under the business regardless of locationIds, so this
                  would be a meaningless, misleading control for that role. */}
              {locations.length > 1 && (member.role === "restaurant_staff" || member.role === "kitchen_staff") && (
                <div className="ml-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted">Locations:</span>
                  {locations.map((loc) => (
                    <label key={loc.id} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={(member.locationIds ?? []).includes(loc.id)}
                        disabled={busyId === member.id}
                        onChange={() => toggleLocation(member, loc.id)}
                      />
                      {loc.name}
                    </label>
                  ))}
                </div>
              )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
