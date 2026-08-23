import { useEffect, useState, type FormEvent } from "react";
import type { AgencyMembershipRole } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAgency } from "../context/AgencyContext";

interface AgencyMemberRow {
  id: string;
  userId: string;
  role: AgencyMembershipRole;
  status: "invited" | "active" | "revoked" | "deactivated";
  businessIds?: string[];
  name?: string;
  email?: string;
}

const ROLE_LABELS: Record<AgencyMembershipRole, string> = {
  agency_owner: "Owner",
  agency_admin: "Admin",
  agency_staff: "Staff",
};

const STATUS_TONE: Record<AgencyMemberRow["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  revoked: "neutral",
  deactivated: "neutral",
};

export function AgencyMembersPage() {
  const { activeAgencyId } = useAgency();
  const [members, setMembers] = useState<AgencyMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AgencyMembershipRole>("agency_staff");
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reload() {
    if (!activeAgencyId) return;
    const { members } = await apiClient.request<{ members: AgencyMemberRow[] }>(`/agencies/${activeAgencyId}/members`);
    setMembers(members);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgencyId]);

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInviting(true);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/members`, { method: "POST", body: { name, email, role } });
      setName("");
      setEmail("");
      setRole("agency_staff");
      setShowForm(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(member: AgencyMemberRow, newRole: AgencyMembershipRole) {
    setError(null);
    setBusyId(member.id);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/members/${member.id}`, { method: "PATCH", body: { role: newRole } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(member: AgencyMemberRow) {
    if (!window.confirm(`Remove ${member.name ?? member.email} from this agency?`)) return;
    setError(null);
    setBusyId(member.id);
    try {
      await apiClient.request(`/agencies/${activeAgencyId}/members/${member.id}`, { method: "PATCH", body: { status: "revoked" } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (!activeAgencyId) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Team</h1>
          <p className="text-sm text-muted">Who can manage this agency and the businesses it manages.</p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Invite member"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {showForm && (
        <Card>
          <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as AgencyMembershipRole)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
              >
                <option value="agency_staff">Staff</option>
                <option value="agency_admin">Admin</option>
                <option value="agency_owner">Owner</option>
              </select>
            </label>
            <Button type="submit" size="sm" disabled={inviting} className="self-start sm:col-span-3">
              {inviting ? "Sending..." : "Send invitation"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <p className="text-muted">Loading team...</p>
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[10rem] flex-1">
                  <p className="flex items-center gap-2 font-medium text-foreground">
                    {m.name ?? m.email ?? "Unknown"}
                    <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                  </p>
                  <p className="text-xs text-muted">{m.email}</p>
                </div>
                <select
                  value={m.role}
                  disabled={busyId === m.id}
                  onChange={(e) => changeRole(m, e.target.value as AgencyMembershipRole)}
                  className="rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground"
                >
                  <option value="agency_staff">{ROLE_LABELS.agency_staff}</option>
                  <option value="agency_admin">{ROLE_LABELS.agency_admin}</option>
                  <option value="agency_owner">{ROLE_LABELS.agency_owner}</option>
                </select>
                <button
                  onClick={() => revoke(m)}
                  disabled={busyId === m.id}
                  className="text-sm font-medium text-danger hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
