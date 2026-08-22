import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Paginated, PlatformRestaurantSummary } from "@restaurant/types";
import { Alert, Badge, Button, Card, Pagination } from "@restaurant/ui";
import { apiClient } from "../lib/api";

const STATUS_TONE: Record<string, "success" | "neutral" | "danger"> = {
  active: "success",
  pending: "neutral",
  suspended: "danger",
};

const PAGE_SIZE = 20;
const STATUS_OPTIONS = ["all", "active", "pending", "suspended"] as const;

export function PlatformRestaurantsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_OPTIONS)[number]>("all");
  const [result, setResult] = useState<Paginated<PlatformRestaurantSummary> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  function reload() {
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (statusFilter !== "all") params.set("status", statusFilter);
    return apiClient.request<Paginated<PlatformRestaurantSummary>>(`/platform/restaurants?${params}`).then(setResult);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch, statusFilter]);

  const restaurants = result?.items ?? [];

  async function setStatus(target: PlatformRestaurantSummary, nextStatus: "active" | "suspended") {
    if (
      nextStatus === "suspended" &&
      !window.confirm(`Suspend "${target.name}"? Its storefront and ordering will stop working immediately.`)
    ) {
      return;
    }
    setUpdatingId(target.id);
    setError(null);
    try {
      const data = await apiClient.request<{ restaurant: PlatformRestaurantSummary }>(
        `/platform/restaurants/${target.id}/status`,
        { method: "PATCH", body: { status: nextStatus } }
      );
      setResult((prev) =>
        prev
          ? { ...prev, items: prev.items.map((r) => (r.id === target.id ? { ...r, status: data.restaurant.status } : r)) }
          : prev
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  async function resendInvite(target: PlatformRestaurantSummary) {
    setUpdatingId(target.id);
    setError(null);
    setNotice(null);
    try {
      const data = await apiClient.request<{ message: string }>(`/platform/restaurants/${target.id}/resend-owner-invite`, {
        method: "POST",
      });
      setNotice(data.message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Restaurants</h1>
          <p className="text-sm text-muted">Every restaurant tenant on the platform.</p>
        </div>
        <Button size="sm" onClick={() => navigate("/platform/restaurants/new")}>
          Create restaurant
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
      <div className="flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, slug, or city..."
          className="max-w-sm rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as (typeof STATUS_OPTIONS)[number])}
          className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All statuses" : s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="text-muted">Loading restaurants...</p>
      ) : (
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Restaurant</th>
              <th className="py-2 pr-3 font-medium">Owner</th>
              <th className="py-2 pr-3 font-medium">Location</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Orders</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 pr-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {restaurants.map((r) => (
              <tr key={r.id}>
                <td className="py-2.5 pr-3 font-medium text-foreground">
                  <Link to={`/platform/restaurants/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>
                </td>
                <td className="py-2.5 pr-3 text-muted">
                  {r.ownerName ?? "—"}
                  {r.ownerInvitePending && (
                    <Badge tone="warning" className="ml-1.5">
                      Invite pending
                    </Badge>
                  )}
                  {r.ownerEmail && <span className="block text-xs">{r.ownerEmail}</span>}
                </td>
                <td className="py-2.5 pr-3 text-muted">{[r.city, r.state, r.country].filter(Boolean).join(", ") || "—"}</td>
                <td className="py-2.5 pr-3">
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                </td>
                <td className="py-2.5 pr-3 text-foreground">{r.orderCount}</td>
                <td className="py-2.5 pr-3 text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="flex flex-wrap gap-3 py-2.5 pr-3">
                  {r.ownerInvitePending && (
                    <button
                      type="button"
                      onClick={() => resendInvite(r)}
                      disabled={updatingId === r.id}
                      className="text-sm font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      Resend invite
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setStatus(r, r.status === "suspended" ? "active" : "suspended")}
                    disabled={updatingId === r.id}
                    className={`text-sm font-medium hover:underline disabled:opacity-50 ${
                      r.status === "suspended" ? "text-primary" : "text-danger"
                    }`}
                  >
                    {updatingId === r.id ? "Working..." : r.status === "suspended" ? "Reactivate" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {restaurants.length === 0 && (
          <p className="py-4 text-center text-sm text-muted">
            {debouncedSearch || statusFilter !== "all" ? "No restaurants match these filters." : "No restaurants yet."}
          </p>
        )}
      </Card>
      )}
      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hasNextPage={result.hasNextPage}
          hasPreviousPage={result.hasPreviousPage}
          onPageChange={setPage}
          totalLabel={`${result.total} restaurant${result.total === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}
