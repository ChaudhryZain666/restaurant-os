import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { connectDB } from "../../config/db.js";
import { closeTestConnections } from "../../test-utils/fixtures.js";
import { GeocodingError } from "./types.js";
import { LocationIqProvider } from "./LocationIqProvider.js";

// LocationIqProvider caches through Redis (config/redis.js — the real client), so these tests
// connect like any other integration test in this suite; each test uses a unique query string to
// avoid one test's cached result silently satisfying another's assertions.
beforeAll(async () => {
  await connectDB();
});
afterAll(async () => {
  await closeTestConnections();
});
afterEach(() => {
  jest.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown, ok = status >= 200 && status < 300) {
  return jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    status,
    ok,
    json: async () => body,
  } as unknown as Response);
}

function place(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    place_id: "loc-1",
    lat: "39.7658",
    lon: "-89.6501",
    display_name: "1200 S 6th St, Springfield, IL 62703, USA",
    address: { house_number: "1200", road: "S 6th St", city: "Springfield", state: "IL", postcode: "62703", country: "USA", country_code: "us" },
    ...overrides,
  };
}

describe("LocationIqProvider.geocode", () => {
  it("maps a valid provider response to a normalized GeocodeResult", async () => {
    const fetchSpy = mockFetchOnce(200, [place()]);
    const provider = new LocationIqProvider("test-key");

    const result = await provider.geocode(`unique query alpha ${Date.now()}`);

    expect(result).toEqual({
      formattedAddress: "1200 S 6th St, Springfield, IL 62703, USA",
      latitude: 39.7658,
      longitude: -89.6501,
      placeId: "loc-1",
      components: {
        line1: "1200 S 6th St",
        city: "Springfield",
        state: "IL",
        postalCode: "62703",
        country: "USA",
        countryCode: "US",
      },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = new URL((fetchSpy.mock.calls[0] as [string | URL])[0]);
    expect(calledUrl.searchParams.get("key")).toBe("test-key");
    // The real API key must never appear in anything derived from the request that could leak
    // (e.g. logs) beyond the outgoing request itself — this just confirms the client sends it,
    // not that it's echoed anywhere in the mapped result.
    expect(JSON.stringify(result)).not.toContain("test-key");
  });

  it("throws no_results for an empty result set, not a generic error", async () => {
    mockFetchOnce(200, []);
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query beta ${Date.now()}`)).rejects.toMatchObject({
      code: "no_results",
    });
  });

  it("throws invalid_input for a too-short query, without calling the provider at all", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode("ab")).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a 401 (bad credentials) to not_configured, not a raw provider error", async () => {
    mockFetchOnce(401, { error: "Invalid key" }, false);
    const provider = new LocationIqProvider("bad-key");

    await expect(provider.geocode(`unique query gamma ${Date.now()}`)).rejects.toMatchObject({
      code: "not_configured",
    });
  });

  it("maps a 429 to rate_limited", async () => {
    mockFetchOnce(429, { error: "Rate limited" }, false);
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query delta ${Date.now()}`)).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("maps a 404 (LocationIQ's own no-match signal) to no_results, not a crash", async () => {
    mockFetchOnce(404, { error: "Unable to geocode" }, false);
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query epsilon ${Date.now()}`)).rejects.toMatchObject({
      code: "no_results",
    });
  });

  it("maps an unreadable/malformed JSON body to provider_error", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as unknown as Response);
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query zeta ${Date.now()}`)).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("maps a network failure to provider_error", async () => {
    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("fetch failed"));
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query eta ${Date.now()}`)).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("maps an aborted (timed-out) request to timeout", async () => {
    const abortError = new Error("The operation was aborted");
    abortError.name = "AbortError";
    jest.spyOn(globalThis, "fetch").mockRejectedValueOnce(abortError);
    const provider = new LocationIqProvider("test-key");

    await expect(provider.geocode(`unique query theta ${Date.now()}`)).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("caches a geocode result — a second identical query doesn't call the provider again", async () => {
    const query = `unique cache query ${Date.now()}`;
    const fetchSpy = mockFetchOnce(200, [place()]);
    const provider = new LocationIqProvider("test-key");

    const first = await provider.geocode(query);
    const second = await provider.geocode(query);

    expect(second).toEqual(first);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("every thrown error is a real GeocodingError instance with a safe, non-internal message", async () => {
    mockFetchOnce(500, { error: "boom" }, false);
    const provider = new LocationIqProvider("test-key");

    try {
      await provider.geocode(`unique query iota ${Date.now()}`);
      throw new Error("expected geocode to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(GeocodingError);
      expect((err as GeocodingError).message).not.toContain("test-key");
    }
  });
});

describe("LocationIqProvider.autocomplete + resolveSuggestion", () => {
  it("returns suggestions and resolves one back to its full geocoded result without a second HTTP call", async () => {
    const fetchSpy = mockFetchOnce(200, [place({ place_id: `resolve-test-${Date.now()}` })]);
    const provider = new LocationIqProvider("test-key");

    const suggestions = await provider.autocomplete(`unique autocomplete query ${Date.now()}`);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toEqual({ id: expect.stringContaining("resolve-test-"), label: "1200 S 6th St, Springfield, IL 62703, USA" });

    const resolved = await provider.resolveSuggestion(suggestions[0].id);
    expect(resolved.latitude).toBe(39.7658);
    expect(resolved.longitude).toBe(-89.6501);
    // Only the one autocomplete call — resolving a suggestion is served from the cache populated
    // during that call, never a second provider round-trip.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array for a too-short query without calling the provider", async () => {
    const fetchSpy = jest.spyOn(globalThis, "fetch");
    const provider = new LocationIqProvider("test-key");

    const suggestions = await provider.autocomplete("a");
    expect(suggestions).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws no_results when resolving an id that was never returned by autocomplete", async () => {
    const provider = new LocationIqProvider("test-key");
    await expect(provider.resolveSuggestion("never-seen-id")).rejects.toMatchObject({ code: "no_results" });
  });
});
