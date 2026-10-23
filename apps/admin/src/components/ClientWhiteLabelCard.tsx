import { useEffect, useState } from "react";
import type { AgencyWhiteLabelFeature, BusinessWhiteLabelStatus, WhiteLabelCapabilityStatus } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { WHITE_LABEL_FEATURE_COPY, WHITE_LABEL_STATE_COPY } from "../lib/whiteLabelCopy";

/**
 * White-label runtime — one client's capabilities as the server actually sees them. Every badge
 * comes from GET .../white-label (whiteLabelStatus.service.ts), which checks real prerequisites
 * (live custom domain, DNS, verified sender, agency offering/suspension). Saving a selection only
 * requests a capability; the message after saving reports the computed result, never a blanket
 * "done", so a pending capability can't look live.
 */
export function ClientWhiteLabelCard({ agencyId, businessId, canManage }: { agencyId: string; businessId: string; canManage: boolean }) {
  const [status, setStatus] = useState<BusinessWhiteLabelStatus | null>(null);
  const [draft, setDraft] = useState<AgencyWhiteLabelFeature[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  function apply(next: BusinessWhiteLabelStatus) {
    setStatus(next);
    setDraft(next.capabilities.filter((c) => c.selected).map((c) => c.feature));
  }

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.request<{ status: BusinessWhiteLabelStatus }>(`/agencies/${agencyId}/businesses/${businessId}/white-label`);
      apply(res.status);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agencyId, businessId]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiClient.request<{ status: BusinessWhiteLabelStatus }>(`/agencies/${agencyId}/businesses/${businessId}/white-label`, {
        method: "PUT",
        body: { enabledFeatures: draft },
      });
      apply(res.status);
      const selected = res.status.capabilities.filter((c) => c.selected);
      const active = selected.filter((c) => c.state === "active").length;
      const waiting = selected.length - active;
      setMessage(
        waiting === 0
          ? { tone: "success", text: selected.length ? `Saved. All ${active} selected capabilities are active.` : "Saved. White-label is off for this client." }
          : { tone: "warning", text: `Saved. ${active} active, ${waiting} not active yet — see what each one needs below.` }
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dirty = status
    ? [...draft].sort().join() !== status.capabilities.filter((c) => c.selected).map((c) => c.feature).sort().join()
    : false;

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-medium text-foreground">White-label</h2>
          <p className="text-sm text-muted">What this client gets, and whether it's really working. Offerings are set in Agency settings.</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
          {busy ? "Checking..." : "Check again"}
        </Button>
      </div>
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      {message && <Alert tone={message.tone === "success" ? "success" : "neutral"}>{message.text}</Alert>}
      {!status ? (
        !error && <p className="text-sm text-muted">Loading white-label status...</p>
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {status.capabilities.map((capability) => (
              <CapabilityRow
                key={capability.feature}
                capability={capability}
                checked={draft.includes(capability.feature)}
                disabled={!canManage || busy || (capability.state === "not_offered" && !capability.selected)}
                onToggle={(on) =>
                  setDraft((current) => (on ? [...new Set([...current, capability.feature])] : current.filter((f) => f !== capability.feature)))
                }
              />
            ))}
          </ul>
          {canManage && (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>
                {busy ? "Saving..." : "Save client capabilities"}
              </Button>
              {dirty && <span className="text-xs text-muted">Unsaved changes</span>}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function CapabilityRow({
  capability,
  checked,
  disabled,
  onToggle,
}: {
  capability: WhiteLabelCapabilityStatus;
  checked: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
}) {
  const copy = WHITE_LABEL_FEATURE_COPY[capability.feature];
  const state = WHITE_LABEL_STATE_COPY[capability.state];
  const id = `wl-${capability.feature}`;
  return (
    <li className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        <label htmlFor={id} className="text-sm font-medium text-foreground">
          {copy.label}
        </label>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="pl-6 text-xs text-muted">{capability.selected ? capability.summary : copy.description}</p>
      {capability.blockers.length > 0 && (
        <ul className="ml-6 flex list-disc flex-col gap-0.5 pl-4 text-xs text-foreground">
          {capability.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {capability.selected && capability.domains && capability.domains.length > 0 && (
        <ul className="ml-6 flex flex-col gap-0.5 text-xs text-muted">
          {capability.domains.map((d) => (
            <li key={d.hostname}>
              <span className="font-mono">{d.hostname}</span> — {d.live ? "served by the platform" : d.mappingStatus.replace("_", " ")}
              {d.dnsPointsToEdge === true ? ", DNS confirmed" : d.dnsPointsToEdge === false ? ", DNS not pointing here yet" : ""}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
