import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { TableWithStatus } from "@restaurant/types";
import { EmptyState, Skeleton } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { IconTable } from "../components/icons";

/**
 * A POS-appropriate view of the same table data TablesPage.tsx (admin) manages — read-only here
 * (creating/editing/QR codes stay an admin-portal responsibility, see Layout's own Tables page),
 * but presented as a scannable floor grid instead of a linear list, with a one-tap "Start sale"
 * that hands off straight into the register with the table preselected.
 */
export function PosTablesPage() {
  const restaurantId = useActiveLocationId();
  const navigate = useNavigate();
  const [tables, setTables] = useState<TableWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // See RegisterPage.tsx's identical guard — avoids a /restaurants/null/tables request during
    // LocationContext's brief resolution window on a cold full-page load.
    if (!restaurantId) return;
    apiClient
      .request<{ tables: TableWithStatus[] }>(`/restaurants/${restaurantId}/tables`)
      .then((res) => setTables(res.tables))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [restaurantId]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (error) return <div className="p-6"><EmptyState title="Couldn't load tables" description={error} /></div>;
  if (tables.length === 0) {
    return (
      <div className="p-6">
        <EmptyState icon={<IconTable className="h-6 w-6" />} title="No tables yet" description="Add tables in Restaurant Admin → Tables to use dine-in here." />
      </div>
    );
  }

  return (
    <div className="p-6">
      <h1 className="mb-4 font-heading text-2xl font-semibold text-foreground">Tables</h1>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tables.map((t) => {
          const occupied = t.status === "occupied";
          return (
            <button
              key={t.id}
              disabled={!t.isActive}
              onClick={() => navigate(`/pos?table=${t.id}`)}
              className={`flex flex-col items-start gap-2 rounded-xl border p-4 text-left shadow-sm transition-all duration-fast disabled:cursor-not-allowed disabled:opacity-50 ${
                occupied ? "border-warning/40 bg-warning/5 hover:border-warning" : "border-border bg-surface hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              }`}
            >
              <span className="flex w-full items-center justify-between">
                <span className="font-heading text-lg font-semibold text-foreground">{t.name}</span>
                <span className={`h-2 w-2 rounded-full ${occupied ? "bg-warning" : "bg-success"}`} aria-hidden />
              </span>
              <span className="text-xs text-muted">
                Seats {t.capacity}
                {t.section ? ` · ${t.section}` : ""}
              </span>
              <span className={`text-xs font-medium ${occupied ? "text-warning" : "text-success"}`}>
                {!t.isActive ? "Inactive" : occupied ? `Occupied · ${t.activeOrderCount} order${t.activeOrderCount === 1 ? "" : "s"}` : "Available"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
