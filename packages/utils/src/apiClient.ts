import type { ApiResponse } from "@restaurant/types";

export interface ApiClientOptions {
  /** Base path for API requests, e.g. "/api/v1". Proxied to the API server in dev. */
  basePath: string;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the automatic 401 -> refresh -> retry cycle (used by the refresh call itself). */
  skipRefresh?: boolean;
  /** NEW-1 — let the request finish even if the page unloads (fetch keepalive). */
  keepalive?: boolean;
}

/** NEW-1 — one name for every tab of this app, so the browser runs their session refreshes one at
 *  a time (Web Locks API). Two tabs refreshing at once would present the same single-use token,
 *  and the second would look like a replay. Where Web Locks is unavailable the refresh simply runs. */
export const REFRESH_LOCK_NAME = "garnishtable-session-refresh";

/** The one Web Locks call used here — typed locally because this package is also compiled by the
 *  API, which has no DOM types (LockManager). */
interface RefreshLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: RefreshLocks } }).navigator?.locks;
  return locks ? locks.request(REFRESH_LOCK_NAME, fn) : fn();
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

/** QA-005 — the API answers a failed schema check with the generic "Validation failed" plus
 *  per-field messages; surface the first field message so the user knows what to fix. */
export function describeApiError(message: string, details: unknown): string {
  if (message !== "Validation failed" || !details || typeof details !== "object") return message;
  for (const [field, messages] of Object.entries(details as Record<string, unknown>)) {
    const first = Array.isArray(messages) ? messages.find((m): m is string => typeof m === "string") : undefined;
    if (!first) continue;
    const label = field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").toLowerCase();
    // A schema message that already names the field reads fine on its own.
    return first.toLowerCase().includes(label) ? first : `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${first}`;
  }
  return message;
}

export function createApiClient({ basePath }: ApiClientOptions) {
  let accessToken: string | null = null;
  // The refresh token is single-use/rotated server-side (see auth.controller.ts's refresh
  // handler), so two concurrent 401s must never each fire their own /auth/refresh — the loser
  // would hit an already-revoked token and surface a spurious "invalid/expired" error even
  // though the winner's retry succeeded. Every caller that needs a refresh while one is already
  // in flight awaits this same promise instead of starting a second one.
  let refreshPromise: Promise<boolean> | null = null;
  // Fires when a request's 401 survives a refresh attempt — i.e. the session is genuinely over
  // (refresh token expired/revoked), not just a transiently-expired access token. AuthContext
  // subscribes to this to clear its `user` state, so a stale "logged in" UI can't linger
  // indefinitely making requests that are guaranteed to keep failing — see request() below.
  let onSessionExpired: (() => void) | null = null;

  function setAccessToken(token: string | null) {
    accessToken = token;
  }

  function setOnSessionExpired(handler: (() => void) | null) {
    onSessionExpired = handler;
  }

  async function rawRequest(path: string, options: RequestOptions = {}) {
    // A FormData body (file uploads) is sent as-is — the browser sets its own multipart
    // Content-Type with the correct boundary, which we must not override by hand.
    const isFormData = options.body instanceof FormData;
    return fetch(`${basePath}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: isFormData ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
    });
  }

  function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        // NEW-1 — keepalive: if the page is left mid-refresh, the browser still completes the
        // request and stores the rotated cookie, instead of keeping the now-used token. Serialised
        // across tabs by withRefreshLock.
        const res = await withRefreshLock(() => rawRequest("/auth/refresh", { method: "POST", skipRefresh: true, keepalive: true }));
        // QA-012 — 204: no session to refresh (signed out), as distinct from a rejected token.
        if (!res.ok || res.status === 204) return false;
        const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
        if (!body.success) return false;
        setAccessToken(body.data.accessToken);
        return true;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let res = await rawRequest(path, options);

    if (res.status === 401 && !options.skipRefresh) {
      const refreshed = await tryRefresh();
      if (refreshed) res = await rawRequest(path, options);

      // Still 401 after a refresh attempt — either the refresh itself failed (no valid/refresh
      // cookie left), or the brand-new access token was rejected too. Either way this is no
      // longer "just retry," it's "this session is over": clear the stale token and let anyone
      // listening (AuthContext) drop the user's session, so every RequireAuth-guarded page
      // naturally redirects to login instead of silently re-attempting a doomed refresh on every
      // subsequent request.
      if (res.status === 401) {
        setAccessToken(null);
        onSessionExpired?.();
      }
    }

    if (res.status === 204) return undefined as T;

    const body = (await res.json()) as ApiResponse<T>;
    if (!body.success) {
      throw new ApiClientError(describeApiError(body.error.message, body.error.details), body.error.code, res.status, body.error.details);
    }
    return body.data;
  }

  return { request, setAccessToken, tryRefresh, setOnSessionExpired, getAccessToken: () => accessToken };
}

export type ApiClient = ReturnType<typeof createApiClient>;
