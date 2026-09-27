import { ClaudeMenuExtractionProvider } from "./ClaudeMenuExtractionProvider.js";
import { MenuExtractionError } from "./MenuExtractionProvider.js";

const originalFetch = global.fetch;

function mockFetchOnce(response: { ok: boolean; status?: number; json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  global.fetch = jest.fn().mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json ?? (async () => ({})),
    text: response.text ?? (async () => ""),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("ClaudeMenuExtractionProvider", () => {
  const provider = new ClaudeMenuExtractionProvider("test-api-key", "claude-sonnet-4-5");

  it("builds a request with the API key header, version header, and forced tool_choice", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        model: "claude-sonnet-4-5",
        content: [{ type: "tool_use", name: "record_menu", input: { rows: [], warnings: [] } }],
      }),
    });

    await provider.extract({ kind: "pdf", buffer: Buffer.from("fake pdf bytes"), fileName: "menu.pdf" });

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.headers["x-api-key"]).toBe("test-api-key");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(options.body);
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_menu" });
    expect(body.tools[0].name).toBe("record_menu");
  });

  it("sends one document content block for a pdf input, base64-encoded", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({ model: "m", content: [{ type: "tool_use", name: "record_menu", input: { rows: [], warnings: [] } }] }),
    });
    const buffer = Buffer.from("hello pdf");
    await provider.extract({ kind: "pdf", buffer, fileName: "menu.pdf" });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    const docBlock = body.messages[0].content.find((c: { type: string }) => c.type === "document");
    expect(docBlock.source.media_type).toBe("application/pdf");
    expect(docBlock.source.data).toBe(buffer.toString("base64"));
  });

  it("sends image content blocks in input order for a multi-image input", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({ model: "m", content: [{ type: "tool_use", name: "record_menu", input: { rows: [], warnings: [] } }] }),
    });
    const buffers = [Buffer.from("a"), Buffer.from("b"), Buffer.from("c")];
    await provider.extract({ kind: "images", buffers, fileNames: ["1.jpg", "2.jpg", "3.jpg"], mimeTypes: ["image/jpeg", "image/jpeg", "image/jpeg"] });

    const [, options] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(options.body);
    const imageBlocks = body.messages[0].content.filter((c: { type: string }) => c.type === "image");
    expect(imageBlocks.map((b: { source: { data: string } }) => b.source.data)).toEqual(buffers.map((b) => b.toString("base64")));
  });

  it("parses the tool_use response into a MenuExtractionResult", async () => {
    mockFetchOnce({
      ok: true,
      json: async () => ({
        model: "claude-sonnet-4-5-20260101",
        content: [
          { type: "text", text: "some preamble the model shouldn't produce with forced tool_choice, but parsed defensively anyway" },
          {
            type: "tool_use",
            name: "record_menu",
            input: {
              rows: [{ categoryName: "Appetizers", itemName: "Garlic Bread", price: "7.00", overallConfidence: 0.9, fieldConfidence: [] }],
              warnings: ["page 2 was hard to read"],
            },
          },
        ],
      }),
    });

    const result = await provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].itemName).toBe("Garlic Bread");
    expect(result.warnings).toEqual(["page 2 was hard to read"]);
    expect(result.modelUsed).toBe("claude-sonnet-4-5-20260101");
  });

  it("throws invalid_credentials on a 401/403 response", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("throws provider_error on a non-2xx, non-auth response", async () => {
    mockFetchOnce({ ok: false, status: 500, text: async () => "internal error" });
    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toMatchObject({
      code: "provider_error",
    });
  });

  it("surfaces Anthropic's own structured error message field, not raw response text (Phase 82 hardening)", async () => {
    mockFetchOnce({
      ok: false,
      status: 429,
      json: async () => ({ type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit." } }),
    });
    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toMatchObject({
      code: "provider_error",
      message: "Extraction service error (HTTP 429): Number of request tokens has exceeded your per-minute rate limit.",
    });
  });

  it("falls back to a generic message, never raw/unexpected response text, when the error body isn't Anthropic's documented JSON shape", async () => {
    mockFetchOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("not json");
      },
    });
    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toMatchObject({
      code: "provider_error",
      message: "Extraction service error (HTTP 502)",
    });
  });

  it("throws provider_error when the response has no tool_use block", async () => {
    mockFetchOnce({ ok: true, json: async () => ({ model: "m", content: [{ type: "text", text: "no tool call" }] }) });
    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toThrow(MenuExtractionError);
  });

  it("maps an aborted request to a timeout error", async () => {
    // Simulates what fetch itself throws once EXTRACTION_PROVIDER_TIMEOUT_MS's real
    // AbortController actually fires — rejecting immediately here (rather than waiting out the
    // real 90s timer) exercises the same abort-handling branch without a slow test.
    global.fetch = jest.fn().mockImplementationOnce(() => {
      const err = new Error("The operation was aborted.");
      err.name = "AbortError";
      return Promise.reject(err);
    }) as unknown as typeof fetch;

    await expect(provider.extract({ kind: "pdf", buffer: Buffer.from("x"), fileName: "menu.pdf" })).rejects.toMatchObject({
      code: "timeout",
    });
  });
});
