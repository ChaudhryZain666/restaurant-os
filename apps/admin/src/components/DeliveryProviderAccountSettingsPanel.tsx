import { useEffect, useState } from "react";
import type { Restaurant, RestaurantDeliveryProviderAccount } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STATUS_TONE: Record<RestaurantDeliveryProviderAccount["status"], "info" | "success" | "danger"> = {
  pending_verification: "info",
  active: "success",
  invalid: "danger",
  disconnected: "info",
};

/**
 * Phase 40 — which courier dispatches a delivery order. "Manual" (the restaurant's own fleet/rider)
 * is the default and needs no setup at all; connecting Uber Direct is optional, BYOC-only (this
 * platform has no pooled Uber Direct account — see restaurantDeliveryProvider.ts), and is a plain
 * credential form since Uber Direct has no OAuth/hosted-onboarding flow the way Stripe Connect does
 * for payments. Mirrors PaymentAccountSettingsPanel.tsx's connect/disconnect UX.
 */
export function DeliveryProviderAccountSettingsPanel({
  restaurant,
  onRestaurantChange,
}: {
  restaurant: Restaurant;
  onRestaurantChange: (restaurant: Restaurant) => void;
}) {
  const restaurantId = useActiveLocationId();
  const [account, setAccount] = useState<RestaurantDeliveryProviderAccount | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect" | "disconnect" | "provider" | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState({ clientId: "", clientSecret: "", customerId: "", webhookSigningSecret: "" });

  async function reload() {
    const res = await apiClient.request<{ account: RestaurantDeliveryProviderAccount | null; webhookUrl: string | null }>(
      `/restaurants/${restaurantId}/delivery-account`
    );
    setAccount(res.account);
    setWebhookUrl(res.webhookUrl);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function handleProviderChange(deliveryProvider: "manual" | "uber_direct") {
    setError(null);
    setBusy("provider");
    try {
      const { restaurant: updated } = await apiClient.request<{ restaurant: Restaurant }>(`/restaurants/${restaurantId}`, {
        method: "PATCH",
        body: { settings: { deliveryProvider } },
      });
      onRestaurantChange(updated);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleConnect() {
    setError(null);
    setBusy("connect");
    try {
      await apiClient.request(`/restaurants/${restaurantId}/delivery-account`, { method: "POST", body: draft });
      setDraft({ clientId: "", clientSecret: "", customerId: "", webhookSigningSecret: "" });
      setShowForm(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    if (
      !window.confirm(
        "Disconnect Uber Direct? Future delivery orders will fall back to manual dispatch (your staff handle them by hand) until you reconnect."
      )
    ) {
      return;
    }
    setError(null);
    setBusy("disconnect");
    try {
      await apiClient.request(`/restaurants/${restaurantId}/delivery-account/disconnect`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-muted">Loading courier settings...</p>;

  const wantsUberDirect = restaurant.settings.deliveryProvider === "uber_direct";
  const connected = account && account.status !== "disconnected";

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
      <legend className="px-1 text-sm font-medium">Courier / dispatch</legend>
      <p className="text-xs text-muted">
        Who actually picks up and delivers a placed order — separate from whether delivery is offered at all and what
        it costs the customer (both set above). "Your own delivery" needs no setup: your staff dispatch and track
        every delivery by hand from the order's detail view. Connecting Uber Direct hands dispatch to a real courier
        automatically instead.
      </p>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${!wantsUberDirect ? "border-primary bg-surface" : "border-border"}`}>
          <input
            type="radio"
            name="deliveryProvider"
            checked={!wantsUberDirect}
            disabled={busy === "provider"}
            onChange={() => handleProviderChange("manual")}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium text-foreground">Your own delivery</span>
            <span className="text-xs text-muted">Staff dispatch and track riders manually. Always available, no setup.</span>
          </span>
        </label>
        <label className={`flex flex-1 cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${wantsUberDirect ? "border-primary bg-surface" : "border-border"}`}>
          <input
            type="radio"
            name="deliveryProvider"
            checked={wantsUberDirect}
            disabled={busy === "provider"}
            onChange={() => handleProviderChange("uber_direct")}
            className="mt-0.5"
          />
          <span className="flex flex-col">
            <span className="font-medium text-foreground">Uber Direct</span>
            <span className="text-xs text-muted">Requires your own Uber Direct merchant account (connect below).</span>
          </span>
        </label>
      </div>

      {wantsUberDirect && !connected && (
        <Alert tone="warning" role="status">
          Delivery orders will fall back to manual dispatch until a Uber Direct account is connected below.
        </Alert>
      )}

      {connected && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Uber Direct</span>
            <Badge tone={STATUS_TONE[account!.status]}>
              {account!.status === "invalid" ? "Verification failed" : account!.status === "pending_verification" ? "Verifying..." : "Active"}
            </Badge>
          </div>
          {account!.credentialFingerprint && <p className="text-xs text-muted">Customer ID: {account!.credentialFingerprint}</p>}
          {account!.status === "invalid" && account!.lastVerificationError && <p className="text-xs text-danger">{account!.lastVerificationError}</p>}
          {account!.status === "active" && webhookUrl && (
            <div className="flex flex-col gap-1 rounded-lg border border-dashed border-border bg-background p-3 text-xs">
              <p className="font-medium text-foreground">Webhook URL — paste this into your Uber Direct dashboard</p>
              <p className="text-muted">Delivery status updates (picked up, delivered, etc.) arrive here.</p>
              <code className="max-w-full truncate rounded bg-surface px-1.5 py-0.5">{webhookUrl}</code>
            </div>
          )}
          <Button type="button" size="sm" variant="destructive" disabled={busy === "disconnect"} onClick={handleDisconnect} className="self-start">
            {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
          </Button>
        </div>
      )}

      {!connected && (
        <>
          {!showForm ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowForm(true)} className="self-start">
              Connect Uber Direct
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium text-foreground">Connect Uber Direct — enter the credentials from your Uber Direct dashboard.</p>
              <label className="flex flex-col gap-1 text-sm">
                Client ID
                <input type="password" value={draft.clientId} onChange={(e) => setDraft({ ...draft, clientId: e.target.value })} className={inputClass} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Client secret
                <input type="password" value={draft.clientSecret} onChange={(e) => setDraft({ ...draft, clientSecret: e.target.value })} className={inputClass} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Customer ID
                <input type="password" value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })} className={inputClass} autoComplete="off" />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Webhook signing secret
                <input
                  type="password"
                  value={draft.webhookSigningSecret}
                  onChange={(e) => setDraft({ ...draft, webhookSigningSecret: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy === "connect"} onClick={handleConnect}>
                  {busy === "connect" ? "Connecting..." : "Connect"}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
