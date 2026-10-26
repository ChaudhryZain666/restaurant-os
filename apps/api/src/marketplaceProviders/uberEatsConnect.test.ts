import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { env } from "../config/env.js";
import { activateStore, buildAuthorizeUrl, discoverStores, exchangeCodeForToken, revokeToken } from "./uberEatsConnect.js";

/**
 * MARKETPLACE_PROVIDER_MODE=mock is this test environment's default (see config/env.ts's own
 * comment) — exactly what Playwright's connect journey exercises too. The "live" HTTP-calling
 * branches are architecturally complete but untested at the unit level, matching every other
 * marketplace adapter's own "researched, never exercised against a live account" status in this
 * codebase (see UberEatsProvider.ts's header comment).
 */
describe("uberEatsConnect (mock mode)", () => {
  it("buildAuthorizeUrl redirects straight back to the given redirectUri with a canned code and the real state — no third-party origin involved", () => {
    const url = buildAuthorizeUrl("state-abc-123", "https://admin.example.com/marketplace/oauth-callback");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://admin.example.com/marketplace/oauth-callback");
    expect(parsed.searchParams.get("code")).toBe("mock_auth_code");
    expect(parsed.searchParams.get("state")).toBe("state-abc-123");
  });

  it("exchangeCodeForToken succeeds for the canned mock code, minting a fresh unique token each time", async () => {
    const first = await exchangeCodeForToken("mock_auth_code", "https://admin.example.com/marketplace/oauth-callback");
    const second = await exchangeCodeForToken("mock_auth_code", "https://admin.example.com/marketplace/oauth-callback");
    expect(first.accessToken).toMatch(/^mock_access_token_/);
    expect(first.expiresIn).toBeGreaterThan(0);
    // Distinct per call — a fixed token would make every mock connection resolve to the same
    // discovered store id, colliding with the real {provider, externalStoreId} uniqueness
    // constraint the moment a second restaurant connects.
    expect(first.accessToken).not.toBe(second.accessToken);
  });

  it("exchangeCodeForToken rejects any other code — simulating a denied/expired/tampered authorization", async () => {
    await expect(exchangeCodeForToken("not-the-real-code", "https://admin.example.com/marketplace/oauth-callback")).rejects.toThrow();
  });

  it("discoverStores returns a store id derived from the access token — same token, same store; different tokens, different stores", async () => {
    const { accessToken: tokenA } = await exchangeCodeForToken("mock_auth_code", "https://admin.example.com/marketplace/oauth-callback");
    const { accessToken: tokenB } = await exchangeCodeForToken("mock_auth_code", "https://admin.example.com/marketplace/oauth-callback");

    const storesA1 = await discoverStores(tokenA);
    const storesA2 = await discoverStores(tokenA);
    const storesB = await discoverStores(tokenB);

    expect(storesA1).toEqual(storesA2);
    expect(storesA1[0]!.externalStoreId).not.toBe(storesB[0]!.externalStoreId);
    expect(storesA1[0]!.displayName).toBe("Mock Restaurant (Uber Eats)");
  });

  it("discoverStores rejects an unrecognized access token", async () => {
    await expect(discoverStores("not-the-real-token")).rejects.toThrow();
  });

  it("revokeToken never throws — best-effort, deliberately a no-op until Uber's real revoke endpoint is confirmed", async () => {
    await expect(revokeToken("mock_access_token_anything")).resolves.toBeUndefined();
  });
});

/** MOCKED HTTP — the live code path with fetch stubbed and UBER_EATS_ENVIRONMENT=sandbox, proving
 *  every merchant-OAuth call targets Uber's sandbox hosts. No request leaves the process. */
describe("uberEatsConnect (live code path, sandbox hosts, mocked HTTP)", () => {
  const saved = { mode: env.MARKETPLACE_PROVIDER_MODE, environment: env.UBER_EATS_ENVIRONMENT, id: env.UBER_EATS_CLIENT_ID, secret: env.UBER_EATS_CLIENT_SECRET };
  beforeEach(() => {
    Object.assign(env, { MARKETPLACE_PROVIDER_MODE: "live", UBER_EATS_ENVIRONMENT: "sandbox", UBER_EATS_CLIENT_ID: "test-client", UBER_EATS_CLIENT_SECRET: "test-secret" });
  });
  afterEach(() => {
    Object.assign(env, { MARKETPLACE_PROVIDER_MODE: saved.mode, UBER_EATS_ENVIRONMENT: saved.environment, UBER_EATS_CLIENT_ID: saved.id, UBER_EATS_CLIENT_SECRET: saved.secret });
    jest.restoreAllMocks();
  });
  const reply = (status: number, body?: unknown) =>
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({ status, ok: status >= 200 && status < 300, json: async () => body ?? {} } as unknown as Response);

  it("authorize URL is on sandbox-login.uber.com with eats.pos_provisioning", () => {
    const url = new URL(buildAuthorizeUrl("st", "https://admin.example.com/cb"));
    expect(url.origin + url.pathname).toBe("https://sandbox-login.uber.com/oauth/v2/authorize");
    expect(url.searchParams.get("scope")).toBe("eats.pos_provisioning");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-client");
  });

  it("production hosts are refused in a non-production process", () => {
    env.UBER_EATS_ENVIRONMENT = "production";
    expect(() => buildAuthorizeUrl("st", "https://admin.example.com/cb")).toThrow(/NODE_ENV=production/);
  });

  it("code exchange (authorization_code) and store discovery use the sandbox hosts", async () => {
    const tokenSpy = reply(200, { access_token: "merchant-token", expires_in: 2592000 });
    await expect(exchangeCodeForToken("code-1", "https://admin.example.com/cb")).resolves.toMatchObject({ accessToken: "merchant-token" });
    const [tokenUrl, tokenInit] = tokenSpy.mock.calls[0] as [string, RequestInit];
    expect(String(tokenUrl)).toBe("https://sandbox-login.uber.com/oauth/v2/token");
    expect(new URLSearchParams(tokenInit.body as URLSearchParams).get("grant_type")).toBe("authorization_code");

    jest.restoreAllMocks();
    const storesSpy = reply(200, { stores: [{ store_id: "store-1", name: "Test Store" }, { name: "no id" }] });
    await expect(discoverStores("merchant-token")).resolves.toEqual([{ externalStoreId: "store-1", displayName: "Test Store" }]);
    expect(String(storesSpy.mock.calls[0]![0])).toBe("https://test-api.uber.com/v1/eats/stores");
  });

  it("a rejected code or failed discovery throws instead of connecting", async () => {
    reply(400, { error: "invalid_grant" });
    await expect(exchangeCodeForToken("bad", "https://admin.example.com/cb")).rejects.toThrow(/HTTP 400/);
    jest.restoreAllMocks();
    reply(403, {});
    await expect(discoverStores("merchant-token")).rejects.toThrow(/HTTP 403/);
  });

  it("activateStore: POST /v1/eats/stores/{id}/pos_data with the merchant token, nominating us order manager", async () => {
    const spy = reply(200, {});
    await activateStore("merchant-token", "store-1", "restaurant-1");
    const [url, init] = spy.mock.calls[0] as [URL, RequestInit];
    const parsed = new URL(String(url));
    expect(parsed.origin + parsed.pathname).toBe("https://test-api.uber.com/v1/eats/stores/store-1/pos_data");
    expect(parsed.searchParams.get("is_order_manager")).toBe("true");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer merchant-token");
    expect(JSON.parse(init.body as string)).toEqual({ is_order_manager: true, integrator_store_id: "restaurant-1" });

    jest.restoreAllMocks();
    reply(403, {});
    await expect(activateStore("merchant-token", "store-1", "restaurant-1")).rejects.toThrow(/activation failed \(HTTP 403\)/);
  });
});
