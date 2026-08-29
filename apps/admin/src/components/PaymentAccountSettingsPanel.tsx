import { useEffect, useState } from "react";
import type { RestaurantPaymentAccount, RestaurantPaymentAccountStatus } from "@restaurant/types";
import { Alert, Badge, Button } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

const STATUS_TONE: Record<RestaurantPaymentAccountStatus, "warning" | "info" | "success" | "danger"> = {
  pending_verification: "info",
  active: "success",
  action_required: "warning",
  invalid: "danger",
  disconnected: "info",
};

/**
 * Phase 37 — restaurant-owned payment accounts (BYOC), redesigned around a provider-native
 * connection for Stripe (Connect + Account Links hosted onboarding — never asks for a secret key
 * or an internal webhook URL) with Safepay's manual credential form kept as a clearly-labeled
 * fallback, since Safepay's current docs confirm no provider-native connection mechanism exists
 * for them at all. Mounted in SettingsPage's "Payment" tab, same as before this redesign.
 *
 * "Connected" and "payments enabled" are always shown as separate facts (Phase 35's own precedent
 * for merchant_credentials' webhook-confirmation distinction, extended here to platform_connect's
 * charges_enabled distinction) — never collapsed into one reassuring badge that could overstate
 * readiness. See restaurantPaymentAccount.controller.ts's syncStripeConnectStatus doc comment: per
 * Stripe's own docs, completing the redirect back from onboarding "doesn't mean... there are no
 * outstanding requirements," so this component never infers success from the redirect alone.
 */
export function PaymentAccountSettingsPanel() {
  const restaurantId = useActiveLocationId();
  const [account, setAccount] = useState<RestaurantPaymentAccount | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect-stripe" | "sync" | "disconnect" | "connect-safepay" | null>(null);
  const [showSafepayForm, setShowSafepayForm] = useState(false);
  const [safepayDraft, setSafepayDraft] = useState({ apiKey: "", secretKey: "", webhookSecret: "", env: "sandbox" as "sandbox" | "production" });

  async function reload() {
    const res = await apiClient.request<{ account: RestaurantPaymentAccount | null; webhookUrl: string | null }>(
      `/restaurants/${restaurantId}/payment-account`
    );
    setAccount(res.account);
    setWebhookUrl(res.webhookUrl);
    return res.account;
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams(window.location.search);
        const stripeConnect = params.get("stripeConnect");
        if (stripeConnect === "return" || stripeConnect === "refresh") {
          // Clean the query param immediately so a page refresh doesn't re-trigger this.
          params.delete("stripeConnect");
          const next = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (next ? `?${next}` : ""));
        }
        if (stripeConnect === "return") {
          // Per Stripe's own docs, completing the redirect only means "the flow was entered and
          // exited properly" — never that onboarding is done. Re-verify server-side immediately.
          await apiClient.request(`/restaurants/${restaurantId}/payment-account/sync-stripe-status`, { method: "POST" });
        } else if (stripeConnect === "refresh") {
          // The Account Link expired/was reused — Stripe's documented contract is to mint a fresh
          // one with the same parameters and redirect immediately, no user action needed.
          const { url } = await apiClient.request<{ url: string }>(`/restaurants/${restaurantId}/payment-account/connect/stripe`, {
            method: "POST",
          });
          window.location.href = url;
          return;
        }
        if (!cancelled) await reload();
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function handleConnectStripe() {
    setError(null);
    setBusy("connect-stripe");
    try {
      const { url } = await apiClient.request<{ url: string }>(`/restaurants/${restaurantId}/payment-account/connect/stripe`, {
        method: "POST",
      });
      window.location.href = url;
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  async function handleSyncStatus() {
    setError(null);
    setBusy("sync");
    try {
      await apiClient.request(`/restaurants/${restaurantId}/payment-account/sync-stripe-status`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleConnectSafepay() {
    setError(null);
    setBusy("connect-safepay");
    try {
      await apiClient.request(`/restaurants/${restaurantId}/payment-account`, {
        method: "POST",
        body: { provider: "safepay", credentials: safepayDraft },
      });
      setSafepayDraft({ apiKey: "", secretKey: "", webhookSecret: "", env: "sandbox" });
      setShowSafepayForm(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnect() {
    setError(null);
    setBusy("disconnect");
    try {
      await apiClient.request(`/restaurants/${restaurantId}/payment-account/disconnect`, { method: "POST" });
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-muted">Loading payment account...</p>;

  const isStripeConnect = account?.provider === "stripe" && account.connectionMode === "platform_connect";

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
      <legend className="px-1 text-sm font-medium">Your own payment account</legend>
      <p className="text-xs text-muted">
        By default, online payments run through this platform's shared account. Connect your own account instead, and
        your orders' money settles directly into it.
      </p>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {account && account.status !== "disconnected" && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium capitalize">{account.provider}</span>
            {isStripeConnect ? (
              <>
                <Badge tone={account.status === "action_required" || account.status === "pending_verification" ? "info" : STATUS_TONE[account.status]}>
                  {account.status === "invalid" ? "Not connected" : "Connected"}
                </Badge>
                {account.status === "active" || account.status === "action_required" ? (
                  <Badge tone={account.chargesEnabled ? "success" : "warning"}>
                    {account.chargesEnabled ? "Payments enabled" : "Payments not yet enabled"}
                  </Badge>
                ) : null}
              </>
            ) : (
              <Badge tone={STATUS_TONE[account.status]}>
                {account.status === "invalid"
                  ? "Verification failed"
                  : account.status === "pending_verification"
                    ? "Verifying..."
                    : "Active"}
              </Badge>
            )}
          </div>

          {isStripeConnect ? (
            <>
              {account.connectedAccountId && <p className="text-xs text-muted">Account: {account.connectedAccountId}</p>}
              {account.status === "action_required" && account.requirementsDue && account.requirementsDue.length > 0 && (
                <div className="rounded-lg border border-dashed border-border bg-background p-3 text-xs">
                  <p className="font-medium text-foreground">Action required — Stripe needs more information</p>
                  <p className="mt-1 text-muted">Continue setup to finish onboarding and start accepting payments.</p>
                </div>
              )}
              {account.status === "invalid" && account.lastVerificationError && (
                <p className="text-xs text-danger">{account.lastVerificationError}</p>
              )}
              {account.lastVerifiedAt && <p className="text-xs text-muted">Last verified: {new Date(account.lastVerifiedAt).toLocaleString()}</p>}
              <div className="flex flex-wrap gap-2">
                {(account.status === "action_required" || account.status === "pending_verification") && (
                  <Button type="button" size="sm" disabled={busy === "connect-stripe"} onClick={handleConnectStripe}>
                    {busy === "connect-stripe" ? "Redirecting..." : "Continue setup"}
                  </Button>
                )}
                {account.status === "active" && (
                  <Button type="button" size="sm" variant="secondary" disabled={busy === "sync"} onClick={handleSyncStatus}>
                    {busy === "sync" ? "Checking..." : "Refresh status"}
                  </Button>
                )}
                <Button type="button" size="sm" variant="destructive" disabled={busy === "disconnect"} onClick={handleDisconnect}>
                  {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </Button>
              </div>
            </>
          ) : (
            <>
              {account.credentialFingerprint && <p className="text-xs text-muted">Key: {account.credentialFingerprint}</p>}
              {account.status === "invalid" && account.lastVerificationError && (
                <p className="text-xs text-danger">{account.lastVerificationError}</p>
              )}
              {account.status === "active" && webhookUrl && !account.firstWebhookReceivedAt && (
                <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-background p-3 text-xs">
                  <p className="font-medium text-foreground">One step left — payments won't be confirmed until this is done</p>
                  <p className="text-muted">
                    Your key is valid, but this platform only learns a customer actually paid once Safepay sends it a
                    webhook. Until then, paid orders may appear unpaid here.
                  </p>
                  <ol className="list-decimal space-y-1 pl-4 text-muted">
                    <li>Open your Safepay dashboard's webhook settings and add an endpoint using the URL below.</li>
                    <li>Enable payment status events.</li>
                    <li>Copy the signing secret it gives you back into the "Webhook secret" field when connecting.</li>
                  </ol>
                  <span className="flex flex-wrap items-center gap-2">
                    <code className="max-w-full truncate rounded bg-surface px-1.5 py-0.5">{webhookUrl}</code>
                  </span>
                </div>
              )}
              {account.status === "active" && account.firstWebhookReceivedAt && (
                <p className="text-xs text-muted">Webhook confirmed — payments will be tracked automatically.</p>
              )}
              {account.status === "active" && (
                <Button type="button" size="sm" variant="destructive" disabled={busy === "disconnect"} onClick={handleDisconnect} className="self-start">
                  {busy === "disconnect" ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {(!account || account.status === "disconnected" || account.status === "invalid") && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-medium text-foreground">Connect Stripe</p>
            <p className="text-xs text-muted">
              The fastest, most secure option. You'll be taken to Stripe to set up your account — we never see or
              store your Stripe credentials.
            </p>
            <Button type="button" size="sm" disabled={busy === "connect-stripe"} onClick={handleConnectStripe} className="self-start">
              {busy === "connect-stripe" ? "Redirecting..." : "Connect Stripe"}
            </Button>
          </div>

          {!showSafepayForm ? (
            <button type="button" onClick={() => setShowSafepayForm(true)} className="self-start text-xs font-medium text-primary hover:underline">
              Use Safepay instead
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium text-foreground">
                Connect Safepay — Safepay doesn't offer a connection flow like Stripe's, so this is API-key entry.
              </p>
              <label className="flex flex-col gap-1 text-sm">
                API key
                <input
                  type="password"
                  value={safepayDraft.apiKey}
                  onChange={(e) => setSafepayDraft({ ...safepayDraft, apiKey: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Secret key
                <input
                  type="password"
                  value={safepayDraft.secretKey}
                  onChange={(e) => setSafepayDraft({ ...safepayDraft, secretKey: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Webhook secret
                <input
                  type="password"
                  value={safepayDraft.webhookSecret}
                  onChange={(e) => setSafepayDraft({ ...safepayDraft, webhookSecret: e.target.value })}
                  className={inputClass}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Environment
                <select
                  value={safepayDraft.env}
                  onChange={(e) => setSafepayDraft({ ...safepayDraft, env: e.target.value as "sandbox" | "production" })}
                  className={inputClass}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="production">Production</option>
                </select>
              </label>
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy === "connect-safepay"} onClick={handleConnectSafepay}>
                  {busy === "connect-safepay" ? "Connecting..." : "Connect"}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => setShowSafepayForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </fieldset>
  );
}
