import { useEffect, useState } from "react";
import { Badge, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";

interface PlatformConfig {
  environment: string;
  billingProvider: string;
  billingProviderEnv: string | null;
  paymentProvider: string;
  paymentProviderEnv: string | null;
  geocodingProvider: string;
  dnsVerifier: string;
  emailProvider: string;
  trialPeriodDays: number;
  pastDueGracePeriodDays: number;
}

function ConfigRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-2 text-sm last:border-0">
      <div>
        <p className="text-foreground">{label}</p>
        {note && <p className="text-xs text-muted">{note}</p>}
      </div>
      <Badge tone="neutral">{value}</Badge>
    </div>
  );
}

/**
 * Phase 28 — replaces the earlier PlaceholderPage stub with a real, read-only diagnostics view
 * (GET /platform/config). Deliberately NOT an editable settings form — env vars are boot-time
 * constants (see config/env.ts), so nothing here can actually be saved without new DB-backed config
 * infrastructure that doesn't exist yet. Every value shown is labeled as environment-configured
 * rather than presented as something this page could change, per the brief's own instruction: "if a
 * setting requires infrastructure that does not exist yet, clearly mark it as unavailable rather
 * than pretending it works."
 */
export function SystemConfigPage() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .request<{ config: PlatformConfig }>("/platform/config")
      .then((res) => setConfig(res.config))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">System configuration</h1>
        <p className="text-sm text-muted">
          Platform-wide defaults and provider selections. Read-only — these are environment variables set at
          deployment time, not editable from this page. Changing any of them requires a new deployment.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-muted">Loading configuration...</p>
      ) : (
        config && (
          <>
            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Environment</h2>
              <ConfigRow label="Environment" value={config.environment} />
            </Card>

            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Billing</h2>
              <ConfigRow
                label="Billing provider"
                value={config.billingProvider}
                note={config.billingProvider === "mock" ? "No real payment provider connected" : undefined}
              />
              {config.billingProviderEnv && <ConfigRow label="Billing provider environment" value={config.billingProviderEnv} />}
              <ConfigRow label="Trial length" value={`${config.trialPeriodDays} days`} note="Non-final default — see commercial decisions" />
              <ConfigRow
                label="Past-due grace period"
                value={`${config.pastDueGracePeriodDays} days`}
                note="Non-final default — see commercial decisions"
              />
            </Card>

            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Restaurant order payments</h2>
              <ConfigRow
                label="Payment provider"
                value={config.paymentProvider}
                note={config.paymentProvider === "mock" ? "No real payment provider connected" : undefined}
              />
              {config.paymentProviderEnv && <ConfigRow label="Payment provider environment" value={config.paymentProviderEnv} />}
            </Card>

            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Delivery & domains</h2>
              <ConfigRow label="Geocoding provider" value={config.geocodingProvider} />
              <ConfigRow label="DNS verifier" value={config.dnsVerifier} />
            </Card>

            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Email</h2>
              <ConfigRow
                label="Email provider"
                value={config.emailProvider}
                note={config.emailProvider === "console" ? "Emails are logged, not actually sent" : undefined}
              />
            </Card>

            <Card>
              <h2 className="mb-2 font-heading text-sm font-medium text-foreground">Not yet available</h2>
              <p className="text-sm text-muted">
                Runtime-editable feature flags and a supported-currencies allowlist would require new database-backed
                configuration infrastructure that doesn't exist yet — not built this phase.
              </p>
            </Card>
          </>
        )
      )}
    </div>
  );
}
