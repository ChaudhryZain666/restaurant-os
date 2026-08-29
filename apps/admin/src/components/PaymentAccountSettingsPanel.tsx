import { useEffect, useState } from "react";
import type {
  RestaurantPaymentAccount,
  RestaurantPaymentAccountProvider,
  RestaurantPaymentAccountStatus,
} from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STATUS_TONE: Record<RestaurantPaymentAccountStatus, "warning" | "info" | "success" | "danger"> = {
  pending_verification: "warning",
  active: "success",
  invalid: "danger",
  disconnected: "info",
};
const STATUS_LABEL: Record<RestaurantPaymentAccountStatus, string> = {
  pending_verification: "Verifying...",
  active: "Active",
  invalid: "Verification failed",
  disconnected: "Disconnected",
};

interface StripeDraft {
  provider: "stripe";
  secretKey: string;
  webhookSecret: string;
}
interface SafepayDraft {
  provider: "safepay";
  apiKey: string;
  secretKey: string;
  webhookSecret: string;
  env: "sandbox" | "production";
}

/**
 * BYOC ("bring your own credentials") — lets a restaurant connect its OWN Stripe or Safepay
 * account instead of using this platform's shared pooled account, so its orders' money settles
 * directly into that account. Self-contained, own lifecycle (connect/disconnect), rendered inside
 * SettingsPage's "Payment" tab below the existing cash/online toggles — mirrors
 * DomainSettingsPanel.tsx's pattern exactly (no nested <form>, own state/API calls). Gated purely
 * by what the API already enforces (restaurant.payments.manage, owner-only, never agency-manageable
 * — see restaurantPaymentAccount.routes.ts) — no client-side role check duplicated here.
 */
export function PaymentAccountSettingsPanel() {
  const restaurantId = useActiveLocationId();
  const [account, setAccount] = useState<RestaurantPaymentAccount | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<StripeDraft | SafepayDraft>({ provider: "stripe", secretKey: "", webhookSecret: "" });

  async function reload() {
    const res = await apiClient.request<{ account: RestaurantPaymentAccount | null; webhookUrl: string | null }>(
      `/restaurants/${restaurantId}/payment-account`
    );
    setAccount(res.account);
    setWebhookUrl(res.webhookUrl);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  function setProvider(provider: RestaurantPaymentAccountProvider) {
    setDraft(
      provider === "stripe"
        ? { provider: "stripe", secretKey: "", webhookSecret: "" }
        : { provider: "safepay", apiKey: "", secretKey: "", webhookSecret: "", env: "sandbox" }
    );
  }

  async function handleConnect() {
    setError(null);
    setBusy(true);
    try {
      const { provider, ...credentials } = draft;
      await apiClient.request(`/restaurants/${restaurantId}/payment-account`, {
        method: "POST",
        body: { provider, credentials },
      });
      setProvider(draft.provider);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setBusy(true);
    try {
      await apiClient.request(`/restaurants/${restaurantId}/payment-account/disconnect`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied — the URL is still visible to read/select manually.
    }
  }

  if (loading) return <p className="text-muted">Loading payment account...</p>;

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
      <legend className="px-1 text-sm font-medium">Your own payment account</legend>
      <p className="text-xs text-muted">
        By default, online payments run through this platform's shared account. Connect your own Stripe or Safepay
        account instead, and your orders' money settles directly into it.
      </p>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {account && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium capitalize">{account.provider}</span>
            <Badge tone={STATUS_TONE[account.status]}>{STATUS_LABEL[account.status]}</Badge>
          </div>
          <p className="text-xs text-muted">Key: {account.credentialFingerprint}</p>
          {account.status === "invalid" && account.lastVerificationError && (
            <p className="text-xs text-danger">{account.lastVerificationError}</p>
          )}
          {account.status === "active" && webhookUrl && (
            <div className="flex flex-col gap-1 text-xs">
              <span className="text-muted">
                Paste this into your {account.provider === "stripe" ? "Stripe" : "Safepay"} dashboard's webhook config:
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <code className="max-w-full truncate rounded bg-background px-1.5 py-0.5">{webhookUrl}</code>
                <button type="button" onClick={handleCopyWebhookUrl} className="font-medium text-primary hover:underline">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </span>
            </div>
          )}
          {account.status === "active" && (
            <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={handleDisconnect} className="self-start">
              {busy ? "Disconnecting..." : "Disconnect"}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <p className="text-xs font-medium text-foreground">
          {account?.status === "active" ? "Connect a different account" : "Connect an account"}
        </p>
        <label className="flex flex-col gap-1 text-sm">
          Provider
          <select
            value={draft.provider}
            onChange={(e) => setProvider(e.target.value as RestaurantPaymentAccountProvider)}
            className={inputClass}
          >
            <option value="stripe">Stripe</option>
            <option value="safepay">Safepay</option>
          </select>
        </label>

        {draft.provider === "stripe" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Secret key
              <input
                type="password"
                value={draft.secretKey}
                onChange={(e) => setDraft({ ...draft, secretKey: e.target.value })}
                placeholder="sk_live_..."
                className={inputClass}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Webhook signing secret
              <input
                type="password"
                value={draft.webhookSecret}
                onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })}
                placeholder="whsec_..."
                className={inputClass}
                autoComplete="off"
              />
            </label>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              API key
              <input
                type="password"
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                className={inputClass}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Secret key
              <input
                type="password"
                value={draft.secretKey}
                onChange={(e) => setDraft({ ...draft, secretKey: e.target.value })}
                className={inputClass}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Webhook secret
              <input
                type="password"
                value={draft.webhookSecret}
                onChange={(e) => setDraft({ ...draft, webhookSecret: e.target.value })}
                className={inputClass}
                autoComplete="off"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Environment
              <select
                value={draft.env}
                onChange={(e) => setDraft({ ...draft, env: e.target.value as "sandbox" | "production" })}
                className={inputClass}
              >
                <option value="sandbox">Sandbox</option>
                <option value="production">Production</option>
              </select>
            </label>
          </>
        )}

        <Button type="button" size="sm" disabled={busy} onClick={handleConnect} className="self-start">
          {busy ? "Connecting..." : "Connect"}
        </Button>
      </div>
    </fieldset>
  );
}
