import { useEffect, useState, type FormEvent } from "react";
import type { Printer, PrinterConnectionType, PrinterPurpose, PrintJobStatus } from "@restaurant/types";
import { Alert, Badge, Button, Card, EmptyState } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { usePrintJob } from "../pos/printing/usePrintJob";
import { PrintStatusBadge } from "../pos/printing/PrintStatusBadge";
import { IconPrinter } from "../components/icons";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const PURPOSE_LABEL: Record<PrinterPurpose, string> = { receipt: "Receipt", kitchen: "Kitchen", bar: "Bar" };
const CONNECTION_LABEL: Record<PrinterConnectionType, string> = {
  browser_print: "Browser / OS print",
  web_serial: "USB or serial (Web Serial)",
  webusb: "USB (WebUSB)",
  local_bridge: "Network printer via local bridge",
};
const CONNECTION_HELP: Record<PrinterConnectionType, string> = {
  browser_print: "Works with any printer that has a normal driver installed on this computer — opens the print dialog, same as printing any page.",
  web_serial: "Direct USB/serial connection from this browser tab. Chrome or Edge on desktop only — not supported in Safari or Firefox.",
  webusb: "Direct USB connection from this browser tab. Chrome or Edge only.",
  local_bridge: "For a printer on your network. Requires a small helper program running on a computer on this network (see setup guide).",
};

interface Draft {
  name: string;
  purpose: PrinterPurpose;
  connectionType: PrinterConnectionType;
  paperWidthMm: "58" | "80";
  bridgeUrl: string;
  isDefault: boolean;
}

function emptyDraft(): Draft {
  return { name: "", purpose: "receipt", connectionType: "browser_print", paperWidthMm: "80", bridgeUrl: "", isDefault: false };
}

/**
 * Phase 57 — printer configuration. Deliberately its own page/route (not a SettingsPage tab): both
 * owner and manager configure printers (restaurant.printers.manage), but SettingsPage itself is
 * owner-only (restaurant.settings.manage), so this can't live there. See Layout.tsx's nav entry.
 */
export function PrinterSettingsPage() {
  const restaurantId = useActiveLocationId();
  const { testPrint } = usePrintJob();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testOutcome, setTestOutcome] = useState<Record<string, PrintJobStatus>>({});

  async function reload() {
    const { printers } = await apiClient.request<{ printers: Printer[] }>(`/restaurants/${restaurantId}/printers`);
    setPrinters(printers);
  }

  useEffect(() => {
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/printers`, {
        method: "POST",
        body: {
          name: draft.name,
          purpose: draft.purpose,
          connectionType: draft.connectionType,
          paperWidthMm: Number(draft.paperWidthMm),
          isDefault: draft.isDefault,
          connectionConfig: draft.connectionType === "local_bridge" ? { bridgeUrl: draft.bridgeUrl } : undefined,
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

  async function toggleEnabled(printer: Printer) {
    setBusyId(printer.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/printers/${printer.id}`, { method: "PATCH", body: { isEnabled: !printer.isEnabled } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function makeDefault(printer: Printer) {
    setBusyId(printer.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/printers/${printer.id}`, { method: "PATCH", body: { isDefault: true } });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(printer: Printer) {
    if (!window.confirm(`Remove printer "${printer.name}"? This can't be undone.`)) return;
    setBusyId(printer.id);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/printers/${printer.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function runTestPrint(printer: Printer) {
    // Opened synchronously, before any await — see usePrintJob.ts's ExecuteContext doc comment.
    const printWindow = window.open("", "_blank");
    setBusyId(printer.id);
    setTestOutcome((prev) => {
      const next = { ...prev };
      delete next[printer.id];
      return next;
    });
    try {
      const outcome = await testPrint(printer.id, printWindow);
      // testPrint always targets one specific, already-resolved printer (no "no default configured"
      // ambiguity like printOrder), so outcome.job is never actually null here in practice — this
      // guard exists only to satisfy the shared PrintOutcome type.
      if (outcome.job) setTestOutcome((prev) => ({ ...prev, [printer.id]: outcome.job!.status }));
    } catch (err) {
      setTestOutcome((prev) => ({ ...prev, [printer.id]: "failed" }));
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-muted">Loading printers...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-foreground">Printers</h1>
          <p className="text-sm text-muted">
            Which printer handles receipts, which handles kitchen tickets — your restaurant can use whatever printer hardware it already has.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add a printer"}</Button>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {showForm && (
        <Card>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Name
                <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClass} placeholder="Front Counter" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Used for
                <select value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value as PrinterPurpose })} className={inputClass}>
                  {Object.entries(PURPOSE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              Connection
              <select
                value={draft.connectionType}
                onChange={(e) => setDraft({ ...draft, connectionType: e.target.value as PrinterConnectionType })}
                className={inputClass}
              >
                {Object.entries(CONNECTION_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{CONNECTION_HELP[draft.connectionType]}</span>
            </label>
            {draft.connectionType === "local_bridge" && (
              <label className="flex flex-col gap-1 text-sm">
                Bridge address
                <input
                  required
                  value={draft.bridgeUrl}
                  onChange={(e) => setDraft({ ...draft, bridgeUrl: e.target.value })}
                  className={inputClass}
                  placeholder="http://localhost:9100"
                />
                <span className="text-xs text-muted">Must be a local address on this computer (e.g. http://localhost:9100) — this connection method requires a separate local print-bridge program, not yet available.</span>
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm">
              Paper width
              <select value={draft.paperWidthMm} onChange={(e) => setDraft({ ...draft, paperWidthMm: e.target.value as "58" | "80" })} className={inputClass}>
                <option value="58">58mm</option>
                <option value="80">80mm</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.isDefault} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />
              Use as the default {PURPOSE_LABEL[draft.purpose].toLowerCase()} printer for this location
            </label>
            <Button type="submit" disabled={saving} className="self-start">
              {saving ? "Adding..." : "Add printer"}
            </Button>
          </form>
        </Card>
      )}

      {printers.length === 0 ? (
        <EmptyState
          icon={<IconPrinter className="h-6 w-6" />}
          title="No printers configured yet"
          description="Add your receipt and kitchen printers here so the POS knows where to send each one."
          action={<Button onClick={() => setShowForm(true)}>Add your first printer</Button>}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {printers.map((printer) => (
            <Card key={printer.id} data-testid={`printer-card-${printer.name}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-heading text-base font-semibold text-foreground">{printer.name}</span>
                  <Badge tone="neutral">{PURPOSE_LABEL[printer.purpose]}</Badge>
                  {printer.isDefault && <Badge tone="success">Default</Badge>}
                  {!printer.isEnabled && <Badge tone="warning">Disabled</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  {testOutcome[printer.id] && <PrintStatusBadge status={testOutcome[printer.id]} />}
                </div>
              </div>
              <p className="text-xs text-muted">
                {CONNECTION_LABEL[printer.connectionType]} · {printer.paperWidthMm}mm paper
              </p>
              <div className="flex flex-wrap gap-3 pt-1 text-xs font-medium">
                <button disabled={busyId === printer.id} onClick={() => runTestPrint(printer)} className="text-primary hover:underline disabled:opacity-50">
                  Test print
                </button>
                {!printer.isDefault && (
                  <button disabled={busyId === printer.id} onClick={() => makeDefault(printer)} className="text-primary hover:underline disabled:opacity-50">
                    Make default
                  </button>
                )}
                <button disabled={busyId === printer.id} onClick={() => toggleEnabled(printer)} className="text-primary hover:underline disabled:opacity-50">
                  {printer.isEnabled ? "Disable" : "Enable"}
                </button>
                <button disabled={busyId === printer.id} onClick={() => remove(printer)} className="text-danger hover:underline disabled:opacity-50">
                  Remove
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
