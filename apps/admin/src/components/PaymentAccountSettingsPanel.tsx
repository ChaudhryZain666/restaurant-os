import { useEffect, useState } from "react";
import type { RestaurantPaymentAccount } from "@restaurant/types";
import { Alert, Badge, Button, ConfirmDialog } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useActiveLocationId } from "../context/LocationContext";

const inputClass = "rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground";

/**
 * Phase 42 — rebuilt around a plain "connected / not connected" merchant experience: online
 * payments now REQUIRE a connected account before they can be turned on at all (see
 * restaurant.controller.ts's settings gate and payment.service.ts's payment-creation gate), so
 * this panel no longer talks about a "platform shared account" fallback that production
 * restaurants can no longer actually rely on. Technical detail (provider IDs, requirements-due
 * lists, last-verified timestamps) lives behind "Manage connection", never in the primary view.
 * The underlying connect/sync/disconnect calls are unchanged from Phase 37 — this is a copy and
 * layout pass, not a new architecture.
 */
export function PaymentAccountSettingsPanel() {
  const restaurantId = useActiveLocationId();
  const [account, setAccount] = useState<RestaurantPaymentAccount | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"connect-stripe" | "sync" | "disconnect" | "connect-safepay" | null>(null);
  const [showSafepayForm, setShowSafepayForm] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
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
      setConfirmingDisconnect(false);
      setShowManage(false);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p className="text-muted">Loading payment account...</p>;

  const isStripeConnect = account?.provider === "stripe" && account.connectionMode === "platform_connect";
  const isConnected = account?.status === "active";
  const needsAttention = account && (account.status === "action_required" || account.status === "pending_verification");
  const isDisconnectable = account && ["active", "action_required", "pending_verification"].includes(account.status);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">Online Payments</h3>
        <p className="mt-1 text-xs text-muted">
          Accept online payments from your customers. Payments go directly to your connected account — we don't take
          a commission on your direct restaurant orders.
        </p>
      </div>

      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}

      {isConnected && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">✓ Payment account connected</Badge>
            {isStripeConnect && !account.chargesEnabled && <Badge tone="warning">Finish setup to start accepting payments</Badge>}
          </div>
          <p className="text-xs text-muted">Your account is connected and ready to accept online payments.</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => setShowManage((s) => !s)} className="self-start">
            {showManage ? "Hide details" : "Manage connection"}
          </Button>

          {showManage && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-background p-3 text-xs">
              {isStripeConnect ? (
                <>
                  {!account.chargesEnabled && (
                    <p className="text-foreground">
                      Stripe still needs a bit more information from you before payments are fully enabled.
                    </p>
                  )}
                  {account.lastVerifiedAt && <p className="text-muted">Last checked: {new Date(account.lastVerifiedAt).toLocaleString()}</p>}
                  <div className="flex flex-wrap gap-2">
                    {!account.chargesEnabled && (
                      <Button type="button" size="sm" disabled={busy === "connect-stripe"} onClick={handleConnectStripe}>
                        {busy === "connect-stripe" ? "Redirecting..." : "Continue setup"}
                      </Button>
                    )}
                    <Button type="button" size="sm" variant="secondary" disabled={busy === "sync"} onClick={handleSyncStatus}>
                      {busy === "sync" ? "Checking..." : "Refresh status"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  {webhookUrl && !account.firstWebhookReceivedAt && (
                    <div className="flex flex-col gap-2">
                      <p className="font-medium text-foreground">One step left — payments won't be confirmed until this is done</p>
                      <p className="text-muted">
                        This platform only learns a customer actually paid once your provider sends a notification back.
                        Until then, paid orders may appear unpaid here.
                      </p>
                      <ol className="list-decimal space-y-1 pl-4 text-muted">
                        <li>Open your provider's dashboard settings and add a notification endpoint using the URL below.</li>
                        <li>Enable payment status events.</li>
                        <li>Copy the signing secret it gives you back the next time you reconnect.</li>
                      </ol>
                      <code className="max-w-full truncate rounded bg-surface px-1.5 py-0.5">{webhookUrl}</code>
                    </div>
                  )}
                  {account.firstWebhookReceivedAt && <p className="text-muted">Notifications confirmed — payments are tracked automatically.</p>}
                </>
              )}
              {isDisconnectable && (
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy === "disconnect"}
                  onClick={() => setConfirmingDisconnect(true)}
                  className="self-start"
                >
                  Disconnect
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {needsAttention && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border bg-background p-3">
          <p className="text-sm font-medium text-foreground">Almost there — finish connecting your account</p>
          <p className="text-xs text-muted">
            {isStripeConnect
              ? "Pick up where you left off to start accepting online payments."
              : "We couldn't verify those details. Check them and try again."}
          </p>
          <div className="flex flex-wrap gap-2">
            {isStripeConnect && (
              <Button type="button" size="sm" disabled={busy === "connect-stripe"} onClick={handleConnectStripe}>
                {busy === "connect-stripe" ? "Redirecting..." : "Continue setup"}
              </Button>
            )}
            <Button type="button" size="sm" variant="destructive" disabled={busy === "disconnect"} onClick={() => setConfirmingDisconnect(true)}>
              Cancel connection
            </Button>
          </div>
        </div>
      )}

      {(!account || account.status === "disconnected" || account.status === "invalid") && (
        <div className="flex flex-col gap-3">
          {account?.status === "invalid" && account.lastVerificationError && (
            <Alert tone="danger">{account.lastVerificationError}</Alert>
          )}
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-medium text-foreground">Connect payment account</p>
            <p className="text-xs text-muted">
              The fastest, most secure option. You'll be taken to Stripe to set up your account — we never see or
              store your credentials.
            </p>
            <Button type="button" size="sm" disabled={busy === "connect-stripe"} onClick={handleConnectStripe} className="self-start">
              {busy === "connect-stripe" ? "Redirecting..." : "Connect payment account"}
            </Button>
          </div>

          {!showSafepayForm ? (
            <button type="button" onClick={() => setShowSafepayForm(true)} className="self-start text-xs font-medium text-primary hover:underline">
              Use a Safepay account instead
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
              <p className="text-xs font-medium text-foreground">Enter your Safepay account details</p>
              <p className="text-xs text-muted">These are stored encrypted and used only to process your payments.</p>
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
                Account type
                <select
                  value={safepayDraft.env}
                  onChange={(e) => setSafepayDraft({ ...safepayDraft, env: e.target.value as "sandbox" | "production" })}
                  className={inputClass}
                >
                  <option value="sandbox">Test (sandbox)</option>
                  <option value="production">Live (production)</option>
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

      <ConfirmDialog
        open={confirmingDisconnect}
        title={isConnected ? "Disconnect payment account?" : "Cancel this connection?"}
        description={
          isConnected
            ? "Online payments will stop working until you connect another account. Cash orders aren't affected, and orders you've already been paid for aren't changed."
            : "This cancels the connection you started. You can start over any time — nothing has been charged."
        }
        tone="danger"
        confirmLabel={isConnected ? "Disconnect" : "Cancel connection"}
        busy={busy === "disconnect"}
        onConfirm={handleDisconnect}
        onCancel={() => setConfirmingDisconnect(false)}
      />
    </div>
  );
}
