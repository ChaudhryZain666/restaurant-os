import { describe, expect, it } from "@jest/globals";
import { buildAuthorizeUrl, discoverStores, exchangeCodeForToken, revokeToken } from "./uberEatsConnect.js";

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
