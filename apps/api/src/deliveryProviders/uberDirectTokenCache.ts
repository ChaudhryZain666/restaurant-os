import { createHash } from "node:crypto";

/**
 * Phase 89 — Uber Direct access tokens, shared across adapter instances.
 *
 * restaurantDeliveryProvider.ts builds a fresh UberDirectProvider for every operation (dispatch,
 * quote, cancel), so a token cached on the instance was thrown away each time and every operation
 * requested a new one. Uber's auth guide says tokens last 30 days, "should be cached and re-used
 * across requests", and allows only 100 client-credential token requests per hour — a busy
 * restaurant would hit that. This process-wide cache fixes it:
 *
 * - Isolation: the key is the account scope (the RestaurantDeliveryProviderAccount id) plus a
 *   SHA-256 of the client id and secret. Two accounts never share a token, and new credentials on
 *   the same account (rotation, reconnect) never reuse the old credentials' token. The secret itself
 *   is never stored here — only its hash, inside the key.
 * - Expiry: a token is reused only until a safety margin before it expires (a day for Uber's
 *   30-day tokens; a tenth of the lifetime for shorter ones).
 * - Concurrency: concurrent callers for the same key share ONE in-flight token request.
 * - Failures: a failed or invalid token response is never cached (the in-flight entry is dropped,
 *   so the next call tries again), and a token Uber rejects later (HTTP 401) is evicted.
 * - Nothing here logs; tokens and secrets never leave memory.
 *
 * Per process: the API and the worker each keep their own cache, so each fetches at most one
 * token per account per ~29 days.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;

export interface UberDirectTokenRequest {
  /** Isolation scope — the delivery-provider account id; "unscoped" for one-off callers. */
  scope: string;
  clientId: string;
  clientSecret: string;
}

export interface FetchedToken {
  value: string;
  /** Lifetime in seconds as reported by Uber. */
  expiresInSeconds: number;
}

interface CachedToken {
  value: string;
  /** Reuse until this time (expiry minus the safety margin). */
  reuseUntil: number;
}

const tokens = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

export function tokenCacheKey(request: UberDirectTokenRequest): string {
  const credentials = createHash("sha256").update(`${request.clientId}\u0000${request.clientSecret}`).digest("hex");
  return `${request.scope}:${credentials}`;
}

/** How long before expiry a token stops being reused. */
export function refreshMarginMs(lifetimeMs: number): number {
  return Math.min(DAY_MS, Math.floor(lifetimeMs / 10));
}

/**
 * A valid cached token for these credentials, or a new one from `fetchToken` (shared with any
 * concurrent caller). Throws whatever `fetchToken` throws; nothing is cached on failure.
 */
export async function getUberDirectToken(
  request: UberDirectTokenRequest,
  fetchToken: () => Promise<FetchedToken>,
  now: () => number = Date.now
): Promise<string> {
  const key = tokenCacheKey(request);
  const cached = tokens.get(key);
  if (cached && cached.reuseUntil > now()) return cached.value;
  if (cached) tokens.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const attempt = (async () => {
    const fetched = await fetchToken();
    if (typeof fetched.value !== "string" || !fetched.value) throw new Error("Uber Direct returned no access token");
    const lifetimeMs = fetched.expiresInSeconds * 1000;
    // Only cache a token with a sane, positive lifetime; anything else is used once and dropped.
    if (Number.isFinite(lifetimeMs) && lifetimeMs > 0) {
      evictIfFull(now());
      tokens.set(key, { value: fetched.value, reuseUntil: now() + lifetimeMs - refreshMarginMs(lifetimeMs) });
    }
    return fetched.value;
  })();
  inFlight.set(key, attempt);
  try {
    return await attempt;
  } finally {
    inFlight.delete(key);
  }
}

/** Drops the cached token for these credentials (e.g. Uber answered 401 with it). Only removes it
 *  if it is still the same token, so a newer one fetched meanwhile survives. */
export function evictUberDirectToken(request: UberDirectTokenRequest, token: string): void {
  const key = tokenCacheKey(request);
  if (tokens.get(key)?.value === token) tokens.delete(key);
}

function evictIfFull(nowMs: number): void {
  if (tokens.size < MAX_ENTRIES) return;
  for (const [key, entry] of tokens) if (entry.reuseUntil <= nowMs) tokens.delete(key);
  // Still full: drop the oldest insertions (Map keeps insertion order).
  for (const key of tokens.keys()) {
    if (tokens.size < MAX_ENTRIES) break;
    tokens.delete(key);
  }
}

/** Tests only. */
export function clearUberDirectTokenCache(): void {
  tokens.clear();
  inFlight.clear();
}

/** Tests only — how many tokens are cached. */
export function uberDirectTokenCacheSize(): number {
  return tokens.size;
}
