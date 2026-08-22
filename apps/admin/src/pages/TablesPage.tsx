import { useEffect, useState, type FormEvent } from "react";
import type { TableWithStatus } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { IconQrCode, IconTable } from "../components/icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

interface Draft {
  name: string;
  capacity: string;
  section: string;
}

function emptyDraft(): Draft {
  return { name: "", capacity: "2", section: "" };
}

export function TablesPage() {
  const { user } = useAuth();
  const restaurantId = user!.restaurantId!;
  const [tables, setTables] = useState<TableWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft());
  const [qrForId, setQrForId] = useState<string | null>(null);
  const [qr, setQr] = useState<{ qrDataUrl: string; url: string } | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  async function reload() {
    const { tables } = await apiClient.request<{ tables: TableWithStatus[] }>(`/restaurants/${restaurantId}/tables`);
    setTables(tables);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/tables`, {
        method: "POST",
        body: {
          name: draft.name,
          capacity: Number(draft.capacity) || 2,
          section: draft.section || undefined,
        },
      });
      setDraft(emptyDraft());
      setShowForm(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(table: TableWithStatus) {
    setEditingId(table.id);
    setEditDraft({ name: table.name, capacity: String(table.capacity), section: table.section ?? "" });
  }

  async function saveEdit(table: TableWithStatus) {
    setError(null);
    setBusyId(table.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/tables/${table.id}`, {
        method: "PATCH",
        body: {
          name: editDraft.name,
          capacity: Number(editDraft.capacity) || 2,
          section: editDraft.section || undefined,
        },
      });
      setEditingId(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(table: TableWithStatus) {
    setError(null);
    setBusyId(table.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/tables/${table.id}`, {
        method: "PATCH",
        body: { isActive: !table.isActive },
      });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(table: TableWithStatus) {
    if (!window.confirm(`Delete table "${table.name}"? This can't be undone.`)) return;
    setError(null);
    setBusyId(table.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/tables/${table.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function viewQr(table: TableWithStatus) {
    setError(null);
    setQrForId(table.id);
    setQr(null);
    setQrLoading(true);
    try {
      const data = await apiClient.request<{ qrDataUrl: string; url: string }>(
        `/restaurants/${restaurantId}/tables/${table.id}/qr`
      );
      setQr(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setQrLoading(false);
    }
  }

  async function regenerateQr(table: TableWithStatus) {
    setError(null);
    setBusyId(table.id);
    try {
      const data = await apiClient.request<{ table: TableWithStatus; qrDataUrl: string; url: string }>(
        `/restaurants/${restaurantId}/tables/${table.id}/regenerate-qr`,
        { method: "POST" }
      );
      setQr({ qrDataUrl: data.qrDataUrl, url: data.url });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function downloadQr(table: TableWithStatus) {
    if (!qr) return;
    const a = document.createElement("a");
    a.href = qr.qrDataUrl;
    a.download = `table-${table.name.replace(/\s+/g, "-").toLowerCase()}-qr.png`;
    a.click();
  }

  function printQr() {
    window.print();
  }

  if (loading) return <p className="text-muted">Loading tables...</p>;

  const activeQrTable = tables.find((t) => t.id === qrForId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Tables</h1>
          <p className="text-sm text-muted">
            Manage your dine-in tables and their QR codes. Each table gets a unique code that opens your menu with
            that table pre-selected — no app, no login required for the customer. Dine-in ordering must also be
            turned on under Settings → Ordering for these codes to accept orders.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New table"}
        </Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {showForm && (
        <Card>
          <h2 className="mb-3 font-heading text-lg font-medium text-foreground">New table</h2>
          <form onSubmit={handleCreate} className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Table 12"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Capacity
              <input
                type="number"
                min="1"
                max="100"
                value={draft.capacity}
                onChange={(e) => setDraft({ ...draft, capacity: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Section (optional)
              <input
                value={draft.section}
                onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                placeholder="e.g. Patio"
                className={inputClass}
              />
            </label>
            <Button type="submit" size="sm" disabled={saving} className="self-start sm:col-span-3">
              {saving ? "Creating..." : "Create table"}
            </Button>
          </form>
        </Card>
      )}

      {tables.length === 0 ? (
        <EmptyState
          icon={<IconTable className="h-6 w-6" />}
          title="No tables yet"
          description="Add a table to generate its QR code for dine-in ordering."
        />
      ) : (
        <Card>
          <ul className="flex flex-col divide-y divide-border">
            {tables.map((table) => (
              <li key={table.id} className="flex flex-wrap items-center gap-3 py-3">
                {editingId === table.id ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className={`w-32 ${inputClass}`}
                    />
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={editDraft.capacity}
                      onChange={(e) => setEditDraft({ ...editDraft, capacity: e.target.value })}
                      className={`w-20 ${inputClass}`}
                    />
                    <input
                      value={editDraft.section}
                      onChange={(e) => setEditDraft({ ...editDraft, section: e.target.value })}
                      placeholder="Section"
                      className={`w-32 ${inputClass}`}
                    />
                    <Button size="sm" disabled={busyId === table.id} onClick={() => saveEdit(table)}>
                      Save
                    </Button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="min-w-[12rem] flex-1">
                    <p className="flex items-center gap-2 font-medium text-foreground">
                      {table.name}
                      <Badge tone={!table.isActive ? "neutral" : table.status === "occupied" ? "warning" : "success"}>
                        {!table.isActive ? "Inactive" : table.status === "occupied" ? "Occupied" : "Available"}
                      </Badge>
                    </p>
                    <p className="text-xs text-muted">
                      Seats {table.capacity}
                      {table.section ? ` · ${table.section}` : ""}
                      {table.activeOrderCount > 0
                        ? ` · ${table.activeOrderCount} active order${table.activeOrderCount === 1 ? "" : "s"} (${table.activeOrderNumbers.join(", ")})`
                        : ""}
                    </p>
                  </div>
                )}
                {editingId !== table.id && (
                  <>
                    <button
                      onClick={() => viewQr(table)}
                      className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                    >
                      <IconQrCode className="h-4 w-4" /> QR code
                    </button>
                    <button
                      onClick={() => startEdit(table)}
                      className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => toggleActive(table)}
                      disabled={busyId === table.id}
                      className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline"
                    >
                      {table.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => remove(table)}
                      disabled={busyId === table.id}
                      className="text-sm font-medium text-danger hover:underline"
                    >
                      Delete
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {activeQrTable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:static print:bg-transparent print:p-0"
          onClick={() => setQrForId(null)}
        >
          <div
            className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl bg-surface p-6 text-center shadow-lg print:shadow-none"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-heading text-lg font-medium text-foreground">{activeQrTable.name}</h2>
            {qrLoading || !qr ? (
              <p className="text-sm text-muted">Loading QR code...</p>
            ) : (
              <>
                <img src={qr.qrDataUrl} alt={`QR code for ${activeQrTable.name}`} className="h-56 w-56" />
                <p className="break-all text-xs text-muted">{qr.url}</p>
                <div className="flex flex-wrap justify-center gap-2 print:hidden">
                  <Button size="sm" variant="outline" onClick={() => downloadQr(activeQrTable)}>
                    Download
                  </Button>
                  <Button size="sm" variant="outline" onClick={printQr}>
                    Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === activeQrTable.id}
                    onClick={() => regenerateQr(activeQrTable)}
                  >
                    Regenerate code
                  </Button>
                </div>
                <p className="text-xs text-muted print:hidden">
                  Regenerating invalidates any previously printed code for this table.
                </p>
              </>
            )}
            <button
              onClick={() => setQrForId(null)}
              className="text-sm font-medium text-foreground/70 hover:text-foreground hover:underline print:hidden"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
