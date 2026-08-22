import { useEffect, useState } from "react";
import type { Paginated, PlatformUserSummary, UserRole } from "@restaurant/types";
import { Badge, Card, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";

const ROLE_LABELS: Record<string, string> = {
  platform_admin: "Platform admin",
  restaurant_owner: "Owner",
  restaurant_manager: "Manager",
  restaurant_staff: "Staff",
  kitchen_staff: "Kitchen staff",
  customer: "Customer",
};

const ROLE_OPTIONS: Array<UserRole | "all"> = [
  "all",
  "platform_admin",
  "restaurant_owner",
  "restaurant_manager",
  "restaurant_staff",
  "kitchen_staff",
  "customer",
];

const PAGE_SIZE = 20;

export function PlatformUsersPage() {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [result, setResult] = useState<Paginated<PlatformUserSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, roleFilter]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (roleFilter !== "all") params.set("role", roleFilter);
    apiClient
      .request<Paginated<PlatformUserSummary>>(`/platform/users?${params}`)
      .then(setResult)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [page, debouncedSearch, roleFilter]);

  const users = result?.items ?? [];

  async function toggleActive(target: PlatformUserSummary) {
    if (target.isActive && !window.confirm(`Deactivate "${target.name}"? They'll lose access immediately.`)) {
      return;
    }
    setUpdatingId(target.id);
    setError(null);
    try {
      const data = await apiClient.request<{ user: PlatformUserSummary }>(`/platform/users/${target.id}/status`, {
        method: "PATCH",
        body: { isActive: !target.isActive },
      });
      setResult((prev) =>
        prev
          ? { ...prev, items: prev.items.map((u) => (u.id === target.id ? { ...u, isActive: data.user.isActive } : u)) }
          : prev
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Users</h1>
        <p className="text-sm text-muted">Every user account across every restaurant on the platform.</p>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="max-w-sm rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as UserRole | "all")}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        >
          {ROLE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {r === "all" ? "All roles" : ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="text-muted">Loading users...</p>
      ) : (
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Name</th>
              <th className="py-2 pr-3 font-medium">Email</th>
              <th className="py-2 pr-3 font-medium">Role</th>
              <th className="py-2 pr-3 font-medium">Restaurant</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 pr-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="py-2.5 pr-3 font-medium text-foreground">{u.name}</td>
                <td className="py-2.5 pr-3 text-muted">{u.email}</td>
                <td className="py-2.5 pr-3 text-foreground">{ROLE_LABELS[u.role] ?? u.role}</td>
                <td className="py-2.5 pr-3 text-muted">{u.restaurantName ?? "—"}</td>
                <td className="py-2.5 pr-3">
                  {u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Deactivated</Badge>}
                </td>
                <td className="py-2.5 pr-3 text-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2.5 pr-3">
                  {u.id === currentUser?.id ? (
                    <span className="text-xs text-muted">You</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleActive(u)}
                      disabled={updatingId === u.id}
                      className={`text-sm font-medium hover:underline disabled:opacity-50 ${u.isActive ? "text-danger" : "text-primary"}`}
                    >
                      {updatingId === u.id ? "Working..." : u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.length === 0 && <p className="py-4 text-center text-sm text-muted">No users found.</p>}
      </Card>
      )}
      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hasNextPage={result.hasNextPage}
          hasPreviousPage={result.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${result.total} user${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
