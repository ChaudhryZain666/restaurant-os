import { afterEach, describe, expect, it, jest } from "@jest/globals";
import {
  clearUberDirectTokenCache,
  evictUberDirectToken,
  getUberDirectToken,
  refreshMarginMs,
  tokenCacheKey,
  uberDirectTokenCacheSize,
  type FetchedToken,
} from "./uberDirectTokenCache.js";
import { UberDirectProvider } from "./UberDirectProvider.js";
import type { DeliveryContact } from "./DeliveryProvider.js";

/**
 * Phase 89 — Uber Direct access tokens are reused across adapter instances (Uber: 30-day tokens,
 * "cache and re-use", 100 token requests/hour), per account and credentials, never across them.
 * Uber is never contacted: fetch and the token request are stubs.
 */
afterEach(() => {
  jest.restoreAllMocks();
  clearUberDirectTokenCache();
});

const A = { scope: "account:aaa", clientId: "client-a", clientSecret: "secret-a" };
const THIRTY_DAYS_S = 2_592_000;

function fetcher(tokens: string[], expiresInSeconds = THIRTY_DAYS_S) {
  let i = 0;
  return jest.fn(async (): Promise<FetchedToken> => ({ value: tokens[i++] ?? `tok-${i}`, expiresInSeconds }));
}

describe("token reuse", () => {
  it("reuses a valid token instead of requesting a new one", async () => {
    const fetchToken = fetcher(["tok-1", "tok-2"]);
    expect(await getUberDirectToken(A, fetchToken)).toBe("tok-1");
    expect(await getUberDirectToken(A, fetchToken)).toBe("tok-1");
    expect(await getUberDirectToken({ ...A }, fetchToken)).toBe("tok-1"); // equal values, new object
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("separate adapter instances for the same account share one token across operations", async () => {
    const auth = { status: 200, ok: true, json: async () => ({ access_token: "shared-token", expires_in: THIRTY_DAYS_S }) } as unknown as Response;
    const quote = () => ({ status: 200, ok: true, json: async () => ({ id: "q", fee: 500, currency: "USD" }) }) as unknown as Response;
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValueOnce(auth).mockResolvedValueOnce(quote()).mockResolvedValueOnce(quote()).mockResolvedValueOnce(quote());

    const contact: DeliveryContact = { name: "x", phone: "+12125550100", address: "1 St", latitude: 40.7, longitude: -74 };
    for (let n = 0; n < 3; n++) {
      // A fresh instance each time, exactly as restaurantDeliveryProvider.ts builds them.
      await new UberDirectProvider("client-a", "secret-a", "cus", "", { tokenScope: "account:aaa" }).getQuote({ pickup: contact, dropoff: contact, currency: "USD" });
    }
    const authCalls = fetchSpy.mock.calls.filter(([url]) => String(url).includes("/oauth/v2/token"));
    expect(authCalls).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchSpy.mock.calls.slice(1)) {
      expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer shared-token" });
    }
  });
});

describe("credential isolation", () => {
  it("never shares a token across accounts, client ids or secrets", async () => {
    const fetchToken = jest.fn(async (): Promise<FetchedToken> => ({ value: `tok-${fetchToken.mock.calls.length}`, expiresInSeconds: THIRTY_DAYS_S }));
    const tokens = await Promise.all([
      getUberDirectToken(A, fetchToken),
      getUberDirectToken({ ...A, scope: "account:bbb" }, fetchToken),
      getUberDirectToken({ ...A, clientId: "client-b" }, fetchToken),
      getUberDirectToken({ ...A, clientSecret: "rotated-secret" }, fetchToken),
    ]);
    expect(new Set(tokens).size).toBe(4);
    expect(fetchToken).toHaveBeenCalledTimes(4);
    expect(uberDirectTokenCacheSize()).toBe(4);
  });

  it("keys hold only a hash of the credentials, never the secret or client id", () => {
    const key = tokenCacheKey(A);
    expect(key.startsWith("account:aaa:")).toBe(true);
    expect(key).not.toContain("secret-a");
    expect(key).not.toContain("client-a");
  });
});

describe("expiry", () => {
  it("stops reusing a token a safety margin before it expires", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const fetchToken = fetcher(["first", "second"], 3600); // 1 hour → 6-minute margin
    expect(refreshMarginMs(3_600_000)).toBe(360_000);

    expect(await getUberDirectToken(A, fetchToken, now)).toBe("first");
    clock += 3_600_000 - 360_000 - 1; // just inside the reuse window
    expect(await getUberDirectToken(A, fetchToken, now)).toBe("first");
    clock += 2; // just past it — still before real expiry, but not reused
    expect(await getUberDirectToken(A, fetchToken, now)).toBe("second");
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it("Uber's 30-day tokens are refreshed one day early", async () => {
    expect(refreshMarginMs(THIRTY_DAYS_S * 1000)).toBe(24 * 60 * 60 * 1000);
    let clock = 0;
    const fetchToken = fetcher(["first", "second"]);
    await getUberDirectToken(A, fetchToken, () => clock);
    clock = 28 * 24 * 60 * 60 * 1000;
    expect(await getUberDirectToken(A, fetchToken, () => clock)).toBe("first");
    clock = 29 * 24 * 60 * 60 * 1000 + 1;
    expect(await getUberDirectToken(A, fetchToken, () => clock)).toBe("second");
  });

  it("a token with no usable lifetime is used once and not cached", async () => {
    const fetchToken = fetcher(["once", "again"], 0);
    expect(await getUberDirectToken(A, fetchToken)).toBe("once");
    expect(uberDirectTokenCacheSize()).toBe(0);
    expect(await getUberDirectToken(A, fetchToken)).toBe("again");
  });
});

describe("concurrency", () => {
  it("concurrent requests for the same account share one token request", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const fetchToken = jest.fn(async (): Promise<FetchedToken> => {
      await gate;
      return { value: "single", expiresInSeconds: THIRTY_DAYS_S };
    });
    const all = Promise.all(Array.from({ length: 10 }, () => getUberDirectToken(A, fetchToken)));
    release();
    expect(await all).toEqual(Array(10).fill("single"));
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it("concurrent requests for different accounts don't wait on each other's request", async () => {
    const fetchToken = fetcher(["a", "b"]);
    const [a, b] = await Promise.all([getUberDirectToken(A, fetchToken), getUberDirectToken({ ...A, scope: "account:bbb" }, fetchToken)]);
    expect([a, b].sort()).toEqual(["a", "b"]);
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });
});

describe("failures", () => {
  it("a failed token request is not cached; every waiting caller sees the failure; the next call retries", async () => {
    let attempt = 0;
    const fetchToken = jest.fn(async (): Promise<FetchedToken> => {
      attempt += 1;
      if (attempt === 1) throw new Error("auth down");
      return { value: "recovered", expiresInSeconds: THIRTY_DAYS_S };
    });
    const results = await Promise.allSettled([getUberDirectToken(A, fetchToken), getUberDirectToken(A, fetchToken)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(uberDirectTokenCacheSize()).toBe(0);
    expect(await getUberDirectToken(A, fetchToken)).toBe("recovered");
  });

  it("an empty token is rejected and not cached", async () => {
    const fetchToken = jest.fn(async (): Promise<FetchedToken> => ({ value: "", expiresInSeconds: THIRTY_DAYS_S }));
    await expect(getUberDirectToken(A, fetchToken)).rejects.toThrow(/no access token/);
    expect(uberDirectTokenCacheSize()).toBe(0);
  });

  it("the adapter caches nothing when Uber refuses the credentials, and its error carries no secret", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue({ status: 401, ok: false, json: async () => ({ error: "invalid_client" }) } as unknown as Response);
    const uber = new UberDirectProvider("client-a", "super-secret-value", "cus", "", { tokenScope: "account:aaa" });
    const error = await uber.getDelivery("del_1").catch((e: Error) => e);
    expect(String((error as Error).message)).toMatch(/authentication failed/);
    expect(String((error as Error).message)).not.toContain("super-secret-value");
    expect(uberDirectTokenCacheSize()).toBe(0);
  });

  it("a token Uber rejects later (401) is evicted, so the next operation fetches a new one", async () => {
    const respond = (status: number, body: unknown) => ({ status, ok: status < 300, json: async () => body }) as unknown as Response;
    const fetchSpy = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(respond(200, { access_token: "revoked", expires_in: THIRTY_DAYS_S }))
      .mockResolvedValueOnce(respond(401, { code: "unauthorized", message: "token revoked" }))
      .mockResolvedValueOnce(respond(200, { access_token: "fresh", expires_in: THIRTY_DAYS_S }))
      .mockResolvedValueOnce(respond(200, { id: "del_1", status: "pending" }));
    const make = () => new UberDirectProvider("client-a", "secret-a", "cus", "", { tokenScope: "account:aaa" });

    await expect(make().getDelivery("del_1")).rejects.toMatchObject({ code: "invalid_credentials" });
    await make().getDelivery("del_1");
    const [, lastInit] = fetchSpy.mock.calls[3] as [string, RequestInit];
    expect(lastInit.headers).toMatchObject({ Authorization: "Bearer fresh" });
  });

  it("eviction only removes the token it was told about", async () => {
    const fetchToken = fetcher(["current"]);
    await getUberDirectToken(A, fetchToken);
    evictUberDirectToken(A, "some-older-token");
    expect(await getUberDirectToken(A, fetchToken)).toBe("current");
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });
});
