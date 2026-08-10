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

  function setAccessToken(token: string | null) {
    accessToken = token;
  }

  async function rawRequest(path: string, options: RequestOptions = {}) {
    return fetch(`${basePath}${path}`, {
      method: options.method ?? "GET",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  }

  async function tryRefresh(): Promise<boolean> {
    const res = await rawRequest("/auth/refresh", { method: "POST", skipRefresh: true });
    if (!res.ok) return false;
    const body = (await res.json()) as ApiResponse<{ accessToken: string }>;
    if (!body.success) return false;
    setAccessToken(body.data.accessToken);
    return true;
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    let res = await rawRequest(path, options);

    if (res.status === 401 && !options.skipRefresh) {
      const refreshed = await tryRefresh();
      if (refreshed) res = await rawRequest(path, options);
    }

    if (res.status === 204) return undefined as T;

    const body = (await res.json()) as ApiResponse<T>;
    if (!body.success) {
      throw new ApiClientError(body.error.message, body.error.code, res.status, body.error.details);
    }
    return body.data;
  }

  return { request, setAccessToken };
}

export type ApiClient = ReturnType<typeof createApiClient>;
