import { describe, expect, it } from "@jest/globals";
import { TestGeocodingProvider } from "./TestGeocodingProvider.js";

describe("TestGeocodingProvider", () => {
  it("geocodes a known fixture address deterministically", async () => {
    const provider = new TestGeocodingProvider();
    const result = await provider.geocode("1200 6th springfield");
    expect(result.latitude).toBe(39.7658);
    expect(result.longitude).toBe(-89.6501);
    expect(result.components?.city).toBe("Springfield");
  });

  it("returns the same coordinates every time for the same query (deterministic, no network)", async () => {
    const provider = new TestGeocodingProvider();
    const first = await provider.geocode("austin congress");
    const second = await provider.geocode("austin congress");
    expect(first).toEqual(second);
  });

  it("throws no_results for text matching no fixture", async () => {
    const provider = new TestGeocodingProvider();
    await expect(provider.geocode("nowhere on earth xyz")).rejects.toMatchObject({ code: "no_results" });
  });

  it("throws invalid_input for a too-short query", async () => {
    const provider = new TestGeocodingProvider();
    await expect(provider.geocode("ab")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("simulates a provider failure via the documented trigger string", async () => {
    const provider = new TestGeocodingProvider();
    await expect(provider.geocode("provider_error_test")).rejects.toMatchObject({ code: "provider_error" });
    await expect(provider.autocomplete("provider_error_test")).rejects.toMatchObject({ code: "provider_error" });
  });

  it("autocomplete returns matching fixtures, and resolveSuggestion returns the exact same result", async () => {
    const provider = new TestGeocodingProvider();
    const suggestions = await provider.autocomplete("boston bella vista");
    expect(suggestions.length).toBeGreaterThan(0);

    const resolved = await provider.resolveSuggestion(suggestions[0].id);
    expect(resolved.formattedAddress).toBe(suggestions[0].label);
    expect(resolved.latitude).toBe(42.3601);
  });

  it("autocomplete returns no suggestions for unmatched text, and resolving an unknown id fails clearly", async () => {
    const provider = new TestGeocodingProvider();
    const suggestions = await provider.autocomplete("completely unmatched text here");
    expect(suggestions).toEqual([]);
    await expect(provider.resolveSuggestion("not-a-real-id")).rejects.toMatchObject({ code: "no_results" });
  });
});
