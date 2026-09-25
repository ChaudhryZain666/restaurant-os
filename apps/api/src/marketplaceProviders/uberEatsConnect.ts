import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";

const AUTHORIZE_URL = "https://auth.uber.com/oauth/v2/authorize";
const TOKEN_URL = "https://auth.uber.com/oauth/v2/token";
const STORES_URL = "https://api.uber.com/v1/eats/stores";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Phase 78 — the restaurant-facing side of Uber Eats' OAuth: minting the authorize redirect,
 * exchanging the returned code for a per-store access token, and discovering which store(s) that
 * token now covers. Deliberately separate from UberEatsProvider.ts (the platform's own
 * `client_credentials` server auth for ongoing menu/order calls) for the exact same reason
 * payments/stripeConnect.ts is separate from StripeProvider.ts: different concern, different auth
 * shape, small enough that sharing a base class costs more clarity than it saves.
 *
 * Researched directly against Uber's own current developer documentation (see UberEatsProvider.ts's
 * own header comment for the full verified/inferred breakdown) — authorize/token endpoints and the
 * store-discovery call are documented; the exact revoke endpoint was NOT independently confirmed, so
 * `revokeToken` below is a deliberate no-op rather than a guessed URL. Still requires Uber's own
 * written API approval before any of this can complete against a real account.
 *
 * MARKETPLACE_PROVIDER_MODE=mock (the default everywhere except a deployment that has deliberately
 * opted into "live") never leaves this deployment: `buildAuthorizeUrl` redirects straight back to
 * our own callback with a canned code, so the whole real code path — state mint, redirect, callback,
 * exchange, discovery, persistence — is exercisable in tests/Playwright with zero third-party origin
 * and zero real credentials, mirroring MockMarketplaceProvider's role for the ingestion pipeline.
 */

const MOCK_AUTH_CODE = "mock_auth_code";
// A fixed prefix, not a fixed token: exchangeCodeForToken mints a fresh random suffix per call, and
// discoverStores derives a store id from that SAME suffix — otherwise every mock-mode connection
// would resolve to the identical externalStoreId "mock_store_1", which collides with
// RestaurantMarketplaceIntegration's real {provider, externalStoreId} uniqueness constraint the
// moment a second restaurant (or a second test) tries to connect (confirmed the hard way while
// writing this phase's own tests).
const MOCK_ACCESS_TOKEN_PREFIX = "mock_access_token_";

export interface UberEatsTokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
}

export interface UberEatsStoreCandidate {
  externalStoreId: string;
  displayName: string;
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  if (env.MARKETPLACE_PROVIDER_MODE === "mock") {
    const url = new URL(redirectUri);
    url.searchParams.set("code", MOCK_AUTH_CODE);
    url.searchParams.set("state", state);
    return url.toString();
  }
  if (!env.UBER_EATS_CLIENT_ID) {
    throw new Error("UBER_EATS_CLIENT_ID is not configured on this deployment.");
  }
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("client_id", env.UBER_EATS_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "eats.pos_provisioning");
  url.searchParams.set("state", state);
  return url.toString();
}

async function withTimeout(run: (signal: AbortSignal) => Promise<Response>, label: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error(`Uber Eats ${label} timed out`);
    throw new Error(`Could not reach Uber Eats to ${label}: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function exchangeCodeForToken(code: string, redirectUri: string): Promise<UberEatsTokenExchangeResult> {
  if (env.MARKETPLACE_PROVIDER_MODE === "mock") {
    if (code !== MOCK_AUTH_CODE) throw new Error("Invalid or expired authorization code.");
    return { accessToken: `${MOCK_ACCESS_TOKEN_PREFIX}${randomUUID()}`, expiresIn: 2_592_000 };
  }
  if (!env.UBER_EATS_CLIENT_ID || !env.UBER_EATS_CLIENT_SECRET) {
    throw new Error("UBER_EATS_CLIENT_ID/UBER_EATS_CLIENT_SECRET are not configured on this deployment.");
  }
  const body = new URLSearchParams({
    client_id: env.UBER_EATS_CLIENT_ID,
    client_secret: env.UBER_EATS_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await withTimeout(
    (signal) => fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal }),
    "exchange the authorization code"
  );
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    throw new Error(`Uber Eats rejected the authorization code (HTTP ${res.status}).`);
  }
  return { accessToken: json.access_token, refreshToken: json.refresh_token, expiresIn: json.expires_in ?? 2_592_000 };
}

export async function discoverStores(accessToken: string): Promise<UberEatsStoreCandidate[]> {
  if (env.MARKETPLACE_PROVIDER_MODE === "mock") {
    if (!accessToken.startsWith(MOCK_ACCESS_TOKEN_PREFIX)) throw new Error("Invalid access token.");
    const suffix = accessToken.slice(MOCK_ACCESS_TOKEN_PREFIX.length);
    return [{ externalStoreId: `mock_store_${suffix}`, displayName: "Mock Restaurant (Uber Eats)" }];
  }
  const res = await withTimeout(
    (signal) => fetch(STORES_URL, { headers: { Authorization: `Bearer ${accessToken}` }, signal }),
    "discover stores"
  );
  const json = (await res.json().catch(() => ({}))) as { stores?: { store_id?: string; name?: string }[] };
  if (!res.ok) throw new Error(`Uber Eats store discovery failed (HTTP ${res.status}).`);
  return (json.stores ?? [])
    .filter((s): s is { store_id: string; name?: string } => Boolean(s.store_id))
    .map((s) => ({ externalStoreId: s.store_id, displayName: s.name ?? s.store_id }));
}

/**
 * Best-effort, never blocks disconnect — deliberately a no-op rather than a guessed endpoint. Uber's
 * exact per-store token revoke endpoint was not independently confirmed against live docs/sandbox
 * (see this file's own header comment); calling a fabricated URL would be worse than not revoking at
 * all. GarnishTable stops USING the stored token immediately on disconnect regardless — the token
 * simply goes unused from that point on. Revisit once real sandbox access confirms the real endpoint.
 */
export async function revokeToken(_accessToken: string): Promise<void> {
  return Promise.resolve();
}
