/** @jest-environment node */
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { createApiClient, REFRESH_LOCK_NAME } from "./apiClient.js";

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

// NEW-1 — a refresh survives the page being left, and tabs never refresh at the same time.
describe("session refresh resilience (NEW-1)", () => {
  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  afterEach(() => {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  });

  it("sends the refresh with keepalive so the rotated cookie is stored even if the page unloads", async () => {
    const fetchMock = mockFetch(json(200, { success: true, data: { accessToken: "t" } }));
    await createApiClient({ basePath: "/api/v1" }).tryRefresh();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(init.credentials).toBe("include");
  });

  it("runs every refresh inside the shared cross-tab lock, one at a time", async () => {
    const order: string[] = [];
    let held = false;
    const queue: Array<() => void> = [];
    const locks = {
      request: async (name: string, fn: () => Promise<unknown>) => {
        expect(name).toBe(REFRESH_LOCK_NAME);
        if (held) await new Promise<void>((resolve) => queue.push(resolve));
        held = true;
        try {
          return await fn();
        } finally {
          held = false;
          queue.shift()?.();
        }
      },
    };
    Object.defineProperty(globalThis, "navigator", { value: { locks }, configurable: true });
    const fn = jest.fn<typeof fetch>().mockImplementation(async () => {
      order.push("start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("end");
      return json(200, { success: true, data: { accessToken: "t" } });
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    // Two "tabs" = two independent clients sharing the browser's lock.
    await Promise.all([createApiClient({ basePath: "/a" }).tryRefresh(), createApiClient({ basePath: "/a" }).tryRefresh()]);
    expect(order).toEqual(["start", "end", "start", "end"]);
  });

  it("still refreshes where the Web Locks API is unavailable", async () => {
    Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
    mockFetch(json(200, { success: true, data: { accessToken: "t" } }));
    await expect(createApiClient({ basePath: "/a" }).tryRefresh()).resolves.toBe(true);
  });
});
