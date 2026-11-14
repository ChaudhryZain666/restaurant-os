/** @jest-environment node */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createApiClient } from "./apiClient.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(...responses: Response[]) {
  const fn = jest.fn<typeof fetch>();
  for (const r of responses) fn.mockResolvedValueOnce(r);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// QA-012 — a signed-out visitor's refresh check is answered 204 (no session), not 401.
describe("session refresh", () => {
  it("204 from /auth/refresh means signed out, without an error", async () => {
    mockFetch(new Response(null, { status: 204 }));
    const client = createApiClient({ basePath: "/api/v1" });
    await expect(client.tryRefresh()).resolves.toBe(false);
    expect(client.getAccessToken()).toBeNull();
  });

  it("401 from /auth/refresh is still a failed refresh", async () => {
    mockFetch(json(401, { success: false, error: { code: "UNAUTHORIZED", message: "Refresh token has been revoked" } }));
    const client = createApiClient({ basePath: "/api/v1" });
    await expect(client.tryRefresh()).resolves.toBe(false);
  });

  it("a successful refresh stores the new access token", async () => {
    mockFetch(json(200, { success: true, data: { accessToken: "new-token" } }));
    const client = createApiClient({ basePath: "/api/v1" });
    await expect(client.tryRefresh()).resolves.toBe(true);
    expect(client.getAccessToken()).toBe("new-token");
  });

  it("a request's 401 with no session left ends the session and surfaces the original error", async () => {
    mockFetch(
      json(401, { success: false, error: { code: "UNAUTHORIZED", message: "Missing access token" } }),
      new Response(null, { status: 204 })
    );
    const client = createApiClient({ basePath: "/api/v1" });
    const expired = jest.fn();
    client.setOnSessionExpired(expired);
    await expect(client.request("/orders")).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
