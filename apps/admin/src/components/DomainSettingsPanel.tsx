import { useEffect, useState } from "react";
import type { DomainMapping, DomainMappingStatus } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STATUS_TONE: Record<DomainMappingStatus, "warning" | "info" | "success"> = {
  pending_verification: "warning",
  verified: "info",
  active: "success",
};
const STATUS_LABEL: Record<DomainMappingStatus, string> = {
  pending_verification: "Verification required",
  verified: "Verified — not live yet",
  active: "Active",
};

/**
 * Phase 22 — the real Domain tab, replacing the previous static placeholder. Deliberately its own
 * self-contained component with its own state/API calls (list/add/verify/activate/deactivate/
 * remove), not wired into SettingsPage's shared form/PATCH — a domain has its own lifecycle,
 * closer to StaffPage.tsx's list+status-badge+action-button pattern than to a form field. No inner
 * <form> element: this renders inside SettingsPage's own outer <form>, and nested <form>s are
 * invalid HTML — "Add a custom domain" is a plain input + explicit button click instead.
 *
 * Gated purely by what the API already enforces (restaurant.settings.manage, owner-only) — this
 * tab is only reachable at all from within SettingsPage, which no unauthorized role can open in
 * the first place, matching this app's established convention of gating server-side rather than
 * duplicating role checks in the UI.
 */
export function DomainSettingsPanel() {
  const { user } = useAuth();
  const restaurantId = useActiveLocationId();
  const [domains, setDomains] = useState<DomainMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [hostnameDraft, setHostnameDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function reload() {
    const { domains } = await apiClient.request<{ domains: DomainMapping[] }>(`/businesses/${user!.businessId}/domains`);
    setDomains(domains.filter((d) => d.locationId === restaurantId));
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function handleAdd() {
    if (!hostnameDraft.trim()) return;
    setError(null);
    setAdding(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/domains`, {
        method: "POST",
        body: { hostname: hostnameDraft },
      });
      setHostnameDraft("");
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function runAction(id: string, action: "check-verification" | "activate" | "deactivate") {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/domains/${id}/${action}`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/domains/${id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // Clipboard access can be denied (permissions, insecure context) — the value is still
      // visible to read/select manually, so this silently no-ops rather than blocking the flow.
    }
  }

  if (loading) return <p className="text-muted">Loading domains...</p>;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <fieldset className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-medium">Platform URL</legend>
        <div className="flex items-center gap-2">
          <p className="text-sm text-foreground">Your storefront is always reachable at the platform's own URL.</p>
          <Badge tone="success">Active</Badge>
        </div>
      </fieldset>

      {domains.map((d) => (
        <fieldset key={d.id} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
          <legend className="px-1 text-sm font-medium">{d.hostname}</legend>
          <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>

          {d.status === "pending_verification" && (
            <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-border p-3 text-xs">
              <p className="text-foreground">
                Add this DNS TXT record at your domain registrar, then check verification below.
              </p>
              <span className="text-muted">Record type: TXT</span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Host:</span>
                <code className="rounded bg-background px-1.5 py-0.5">{d.verificationRecordHost}</code>
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Value:</span>
                <code className="max-w-full truncate rounded bg-background px-1.5 py-0.5">{d.verificationToken}</code>
                <button
                  type="button"
                  onClick={() => handleCopy(d.id, d.verificationToken)}
                  className="font-medium text-primary hover:underline"
                >
                  {copiedId === d.id ? "Copied!" : "Copy"}
                </button>
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {d.status === "pending_verification" && (
              <Button type="button" size="sm" disabled={busyId === d.id} onClick={() => runAction(d.id, "check-verification")}>
                {busyId === d.id ? "Checking..." : "Check verification"}
              </Button>
            )}
            {d.status === "verified" && (
              <Button type="button" size="sm" disabled={busyId === d.id} onClick={() => runAction(d.id, "activate")}>
                {busyId === d.id ? "Activating..." : "Activate"}
              </Button>
            )}
            {d.status === "active" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === d.id}
                onClick={() => runAction(d.id, "deactivate")}
              >
                {busyId === d.id ? "Deactivating..." : "Deactivate"}
              </Button>
            )}
            <Button type="button" size="sm" variant="destructive" disabled={busyId === d.id} onClick={() => handleRemove(d.id)}>
              Remove
            </Button>
          </div>
        </fieldset>
      ))}

      <fieldset className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4">
        <legend className="px-1 text-sm font-medium">Add a custom domain</legend>
        <label className="flex flex-col gap-1 text-sm">
          Domain
          <input
            value={hostnameDraft}
            onChange={(e) => setHostnameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAdd();
              }
            }}
            placeholder="orders.yourrestaurant.com"
            className={inputClass}
          />
        </label>
        <Button type="button" size="sm" disabled={adding || !hostnameDraft.trim()} onClick={handleAdd} className="self-start">
          {adding ? "Adding..." : "Add domain"}
        </Button>
      </fieldset>
    </div>
  );
}
