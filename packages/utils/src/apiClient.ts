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
    });
  }

  function tryRefresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        const res = await rawRequest("/auth/refresh", { method: "POST", skipRefresh: true });
        if (!res.ok) return false;
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
      throw new ApiClientError(body.error.message, body.error.code, res.status, body.error.details);
    }
    return body.data;
  }

  return { request, setAccessToken, tryRefresh, setOnSessionExpired, getAccessToken: () => accessToken };
}

export type ApiClient = ReturnType<typeof createApiClient>;
