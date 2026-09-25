import { useEffect, useState } from "react";
import type { MarketplaceProviderCapabilities, MarketplaceProviderName, RestaurantMarketplaceIntegration } from "@restaurant/types";
import { Alert, Badge, Button, Card } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";
import { IconStore } from "../components/icons";

const PROVIDER_LABELS: Record<MarketplaceProviderName, string> = {
  uber_eats: "Uber Eats",
  doordash: "DoorDash",
  foodpanda: "foodpanda",
};

const PROVIDERS: MarketplaceProviderName[] = ["uber_eats", "doordash", "foodpanda"];

const STATUS_TONE: Record<RestaurantMarketplaceIntegration["status"], "info" | "success" | "danger" | "warning"> = {
  pending_verification: "info",
  active: "success",
  action_required: "warning",
  pending_provider_approval: "info",
  invalid: "danger",
  disconnected: "info",
};

const STATUS_LABEL: Record<RestaurantMarketplaceIntegration["status"], string> = {
  pending_verification: "Verifying...",
  active: "Connected",
  action_required: "Needs attention",
  pending_provider_approval: "Pending",
  invalid: "Verification failed",
  disconnected: "Not connected",
};

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

function formatDate(iso?: string): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString();
}

/**
 * One simple page — three provider cards (Uber Eats/DoorDash/foodpanda), each showing whatever this
 * restaurant's own connection record actually says. Deliberately NOT a polished dashboard (per this
 * phase's own scope) — every state shown here is a real, current field on a real integration
 * document; a provider this restaurant never connected to simply shows "Not connected," never a
 * placeholder "Coming soon" or fake "Connected" badge. Mirrors
 * DeliveryProviderAccountSettingsPanel.tsx's connect/disconnect UX, generalized to three
 * simultaneously-connectable providers instead of one.
 */
export function MarketplaceIntegrationsPage() {
  const restaurantId = useActiveLocationId();
  const [integrations, setIntegrations] = useState<RestaurantMarketplaceIntegration[]>([]);
  const [capabilities, setCapabilities] = useState<Record<MarketplaceProviderName, MarketplaceProviderCapabilities> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // `${provider}:${action}`
  const [connectingProvider, setConnectingProvider] = useState<MarketplaceProviderName | null>(null);
  const [storeIdDraft, setStoreIdDraft] = useState("");

  async function reload() {
    const res = await apiClient.request<{
      integrations: RestaurantMarketplaceIntegration[];
      capabilities: Record<MarketplaceProviderName, MarketplaceProviderCapabilities>;
    }>(`/restaurants/${restaurantId}/marketplace-integrations`);
    setIntegrations(res.integrations);
    setCapabilities(res.capabilities);
  }

  /** Phase 78 — Uber Eats' real merchant-facing OAuth flow: this only mints a fresh authorize URL
   *  and redirects; the actual token exchange/store discovery happens server-side once the owner
   *  returns from Uber's own consent screen (see MarketplaceOAuthCallbackPage.tsx). */
  async function handleOAuthConnect(provider: MarketplaceProviderName) {
    setError(null);
    setBusy(`${provider}:connect`);
    try {
      const { url } = await apiClient.request<{ url: string }>(
        `/restaurants/${restaurantId}/marketplace-integrations/${provider}/connect/start`,
        { method: "POST" }
      );
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function handleConnect(provider: MarketplaceProviderName) {
    setError(null);
    setBusy(`${provider}:connect`);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/marketplace-integrations`, {
        method: "POST",
        body: { provider, externalStoreId: storeIdDraft },
      });
      setStoreIdDraft("");
      setConnectingProvider(null);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect(provider: MarketplaceProviderName) {
    if (!window.confirm(`Disconnect ${PROVIDER_LABELS[provider]}? Orders will no longer be received from this provider until reconnected.`)) return;
    setError(null);
    setBusy(`${provider}:disconnect`);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/marketplace-integrations/${provider}/disconnect`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleSync(provider: MarketplaceProviderName) {
    setError(null);
    setBusy(`${provider}:sync`);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/marketplace-integrations/${provider}/sync`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-muted">Loading marketplace integrations...</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Marketplace integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Receive orders directly from third-party marketplaces into this same order system — the same kitchen, the
          same POS, the same reporting as every other order.
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((provider) => {
          const integration = integrations.find((i) => i.provider === provider && i.status !== "disconnected");
          const connected = Boolean(integration && integration.status !== "disconnected");
          const connectCapability = capabilities?.[provider]?.connect;
          const mechanism = connectCapability?.mechanism;

          return (
            <Card key={provider} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconStore className="h-5 w-5 text-muted" />
                <span className="font-medium text-foreground">{PROVIDER_LABELS[provider]}</span>
                {integration ? (
                  <Badge tone={STATUS_TONE[integration.status]} className="ml-auto">
                    {STATUS_LABEL[integration.status]}
                  </Badge>
                ) : mechanism === "not_available" ? (
                  <Badge tone="info" className="ml-auto">
                    Coming soon
                  </Badge>
                ) : mechanism === "platform_admin_managed" ? (
                  <Badge tone="info" className="ml-auto">
                    Pending — managed by GarnishTable
                  </Badge>
                ) : (
                  <Badge tone="info" className="ml-auto">
                    Not connected
                  </Badge>
                )}
              </div>

              {integration && (
                <dl className="flex flex-col gap-1 text-xs text-muted">
                  {integration.externalStoreId && (
                    <div className="flex justify-between gap-2">
                      <dt>Store ID</dt>
                      <dd className="truncate text-foreground">{integration.externalStoreId}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <dt>Last sync</dt>
                    <dd className="text-foreground">{formatDate(integration.lastMenuSyncedAt)}</dd>
                  </div>
                  {integration.lastMenuSyncError && <p className="text-danger">{integration.lastMenuSyncError}</p>}
                  {integration.status === "invalid" && integration.lastVerificationError && <p className="text-danger">{integration.lastVerificationError}</p>}
                </dl>
              )}

              <div className="mt-auto flex flex-wrap gap-2">
                {connected ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={busy === `${provider}:sync`}
                      onClick={() => handleSync(provider)}
                    >
                      {busy === `${provider}:sync` ? "Syncing..." : "Sync menu"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busy === `${provider}:disconnect`}
                      onClick={() => handleDisconnect(provider)}
                    >
                      {busy === `${provider}:disconnect` ? "Disconnecting..." : "Disconnect"}
                    </Button>
                  </>
                ) : mechanism === "not_available" ? (
                  <div className="flex w-full flex-col gap-1">
                    <Button type="button" size="sm" variant="secondary" disabled>
                      Connect {PROVIDER_LABELS[provider]}
                    </Button>
                    {connectCapability?.unavailableReason && <p className="text-xs text-muted">{connectCapability.unavailableReason}</p>}
                  </div>
                ) : mechanism === "platform_admin_managed" ? (
                  connectCapability?.unavailableReason && <p className="text-xs text-muted">{connectCapability.unavailableReason}</p>
                ) : mechanism === "oauth_redirect" ? (
                  <Button type="button" size="sm" disabled={busy === `${provider}:connect`} onClick={() => handleOAuthConnect(provider)}>
                    {busy === `${provider}:connect` ? "Redirecting..." : `Connect ${PROVIDER_LABELS[provider]}`}
                  </Button>
                ) : connectingProvider === provider ? (
                  <div className="flex w-full flex-col gap-2">
                    <label className="flex flex-col gap-1 text-xs">
                      Your store ID on {PROVIDER_LABELS[provider]}
                      <input value={storeIdDraft} onChange={(e) => setStoreIdDraft(e.target.value)} className={inputClass} autoComplete="off" />
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy === `${provider}:connect` || !storeIdDraft} onClick={() => handleConnect(provider)}>
                        {busy === `${provider}:connect` ? "Connecting..." : "Connect"}
                      </Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => setConnectingProvider(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="secondary" onClick={() => setConnectingProvider(provider)}>
                    Connect
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
