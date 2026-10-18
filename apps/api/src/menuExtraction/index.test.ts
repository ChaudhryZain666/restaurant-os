import { buildLiveProvider, shouldWarnAboutMockInProduction } from "./index.js";
import { ClaudeMenuExtractionProvider } from "./ClaudeMenuExtractionProvider.js";
import { OpenAIMenuExtractionProvider } from "./OpenAIMenuExtractionProvider.js";

/** Phase 82 hardening — the pure decision logic behind getMenuExtractionProvider()'s production
 *  warning (unlike a misconfigured payment/storage provider, a forgotten
 *  MENU_EXTRACTION_PROVIDER_MODE=live in production fails silently WRONG, not loudly: the mock
 *  still "succeeds," producing fake placeholder rows a busy owner could publish to their real
 *  menu without noticing). */
describe("shouldWarnAboutMockInProduction", () => {
  it("warns when production is left on the mock provider", () => {
    expect(shouldWarnAboutMockInProduction("production", "mock")).toBe(true);
  });

  it("does not warn when production is correctly configured for live extraction", () => {
    expect(shouldWarnAboutMockInProduction("production", "live")).toBe(false);
  });

  it("never warns outside production, regardless of mode", () => {
    expect(shouldWarnAboutMockInProduction("development", "mock")).toBe(false);
    expect(shouldWarnAboutMockInProduction("test", "mock")).toBe(false);
  });
});

// Phase 89 — which live provider MENU_EXTRACTION_PROVIDER selects. No network: constructing a
// provider makes no request.
describe("buildLiveProvider", () => {
  const base = { anthropicModel: "claude-sonnet-4-5", openaiModel: "gpt-4.1" };

  it("claude (the default) builds the Claude adapter, exactly as before", () => {
    const provider = buildLiveProvider({ ...base, provider: "claude", anthropicApiKey: "a-key" });
    expect(provider).toBeInstanceOf(ClaudeMenuExtractionProvider);
    expect(provider.name).toBe("claude");
  });

  it("openai builds the OpenAI adapter", () => {
    const provider = buildLiveProvider({ ...base, provider: "openai", openaiApiKey: "o-key" });
    expect(provider).toBeInstanceOf(OpenAIMenuExtractionProvider);
    expect(provider.name).toBe("openai");
  });

  it("a missing key for the chosen provider is a clear error — never a fallback to the other provider", () => {
    expect(() => buildLiveProvider({ ...base, provider: "openai", anthropicApiKey: "a-key" })).toThrow('Provider "openai" requires OPENAI_API_KEY to be set.');
    expect(() => buildLiveProvider({ ...base, provider: "claude", openaiApiKey: "o-key" })).toThrow('Provider "claude" requires ANTHROPIC_API_KEY to be set.');
  });
});
