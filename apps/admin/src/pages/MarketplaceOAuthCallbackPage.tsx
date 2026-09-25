import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Spinner } from "@restaurant/ui";
import { apiClient } from "../lib/api";
import { useLocation } from "../context/LocationContext";

interface StoreCandidate {
  externalStoreId: string;
  displayName: string;
}

type CallbackResult =
  | { status: "connected"; restaurantId: string }
  | { status: "select_store"; stateId: string; restaurantId: string; candidates: StoreCandidate[] }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; message: string };

interface CapturedParams {
  code?: string;
  state: string | null;
  providerError?: string;
}

/**
 * Module-level (not component-level) state: Layout.tsx's <Outlet key={...activeBusinessId...
 * activeLocationId}> remounts the routed page as a BRAND NEW component instance every time either
 * of those resolves from its initial null to a real value — which happens several times in quick
 * succession on a fresh full-page load (the exact situation this page always lands in, since
 * handleOAuthConnect navigates here via a real window.location.href redirect). Confirmed live via
 * Playwright: this page's query-param read/strip and its API call were both observed re-running
 * across 3-4 remounts before activeBusinessId/activeLocationId settled, with only the FIRST mount
 * ever seeing the real query string. Component-local state (useState/useRef) resets on every one of
 * those remounts; a module-level singleton does not, since the module itself is only ever evaluated
 * once per real page load.
 */
let capturedParams: CapturedParams | null = null;
let inFlightRequest: Promise<CallbackResult> | null = null;

function captureParamsOnce(): CapturedParams {
  if (capturedParams === null) {
    const parsed = new URLSearchParams(window.location.search);
    capturedParams = { code: parsed.get("code") ?? undefined, state: parsed.get("state"), providerError: parsed.get("error") ?? undefined };
    // Clean the query string immediately so a refresh never re-submits the same code/state.
    window.history.replaceState({}, "", window.location.pathname);
  }
  return capturedParams;
}

/** Memoized on the module, not just deduped per-mount: the state this submits is single-use
 *  server-side (OAuthConnectState.consumedAt), so firing it more than once would have the SECOND
 *  call legitimately come back "expired" and clobber the first call's real "connected" result. */
function getOrStartCallbackRequest(params: CapturedParams): Promise<CallbackResult> | null {
  if (!params.state) return null;
  if (!inFlightRequest) {
    inFlightRequest = apiClient.request<CallbackResult>("/marketplace-oauth/uber_eats/callback", {
      method: "POST",
      body: { code: params.code, state: params.state, error: params.providerError },
    });
  }
  return inFlightRequest;
}

/**
 * Phase 78 — where the browser lands after the owner completes (or cancels) Uber Eats' own consent
 * screen. Mounted BARE at /marketplace/oauth-callback (no `:restaurantId` — apps/admin has no
 * tenant-scoped routing, and this redirect carries no Authorization header the way a normal API call
 * does, so there's nothing to put in the URL). Everything about which restaurant this connection
 * belongs to comes back from the server (derived from the OAuth state it consumed), never guessed
 * client-side — this page only switches the admin's active location to match afterward, purely a UX
 * convenience so the owner lands looking at the restaurant they just connected.
 */
export function MarketplaceOAuthCallbackPage() {
  const navigate = useNavigate();
  const { activeLocationId, switchLocation } = useLocation();
  const [result, setResult] = useState<CallbackResult | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [params] = useState(captureParamsOnce);

  useEffect(() => {
    if (!params.state) {
      setResult({ status: "error", message: "This connection link is missing required information. Please start over." });
      return;
    }

    let cancelled = false;
    const request = getOrStartCallbackRequest(params);
    request
      ?.then((res) => {
        if (cancelled) return;
        setResult(res);
        if (res.status === "connected" && res.restaurantId !== activeLocationId) {
          switchLocation(res.restaurantId);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    if (result?.status === "connected") {
      const timer = setTimeout(() => navigate("/marketplace"), 1500);
      return () => clearTimeout(timer);
    }
  }, [result, navigate]);

  async function handleSelectStore(stateId: string, externalStoreId: string) {
    setSelecting(true);
    setError(null);
    try {
      const res = await apiClient.request<CallbackResult>("/marketplace-oauth/uber_eats/select-store", {
        method: "POST",
        body: { stateId, externalStoreId },
      });
      setResult(res);
      if (res.status === "connected" && res.restaurantId !== activeLocationId) {
        switchLocation(res.restaurantId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSelecting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      {error && (
        <Alert tone="danger" role="alert" className="w-full text-left">
          {error}
        </Alert>
      )}

      {!result && !error && (
        <>
          <Spinner size="lg" />
          <p className="text-sm text-muted">Finishing your Uber Eats connection...</p>
        </>
      )}

      {result?.status === "connected" && (
        <Card className="flex w-full flex-col items-center gap-2 p-6">
          <p className="text-lg font-medium text-foreground">Uber Eats connected ✓</p>
          <p className="text-sm text-muted">Taking you back to your marketplace integrations...</p>
        </Card>
      )}

      {result?.status === "select_store" && (
        <Card className="flex w-full flex-col gap-3 p-6 text-left">
          <p className="text-sm font-medium text-foreground">Which store is this restaurant?</p>
          <p className="text-xs text-muted">Your Uber Eats account has more than one store — pick the one for this restaurant.</p>
          <div className="flex flex-col gap-2">
            {result.candidates.map((c) => (
              <Button
                key={c.externalStoreId}
                type="button"
                variant="secondary"
                disabled={selecting}
                onClick={() => handleSelectStore(result.stateId, c.externalStoreId)}
                className="justify-start"
              >
                {c.displayName}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {result?.status === "denied" && (
        <Card className="flex w-full flex-col items-center gap-2 p-6">
          <p className="text-lg font-medium text-foreground">Connection cancelled</p>
          <p className="text-sm text-muted">You didn't finish connecting Uber Eats — no changes were made.</p>
          <Button type="button" onClick={() => navigate("/marketplace")} className="mt-2">
            Back to marketplace integrations
          </Button>
        </Card>
      )}

      {result?.status === "expired" && (
        <Card className="flex w-full flex-col items-center gap-2 p-6">
          <p className="text-lg font-medium text-foreground">This connection attempt expired</p>
          <p className="text-sm text-muted">Please start over from your marketplace integrations page.</p>
          <Button type="button" onClick={() => navigate("/marketplace")} className="mt-2">
            Back to marketplace integrations
          </Button>
        </Card>
      )}

      {result?.status === "error" && (
        <Card className="flex w-full flex-col items-center gap-2 p-6">
          <p className="text-lg font-medium text-foreground">We couldn't connect Uber Eats</p>
          <p className="text-sm text-muted">{result.message}</p>
          <Button type="button" onClick={() => navigate("/marketplace")} className="mt-2">
            Back to marketplace integrations
          </Button>
        </Card>
      )}
    </div>
  );
}
