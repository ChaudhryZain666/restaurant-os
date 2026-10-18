import { MENU_RESULT_STRICT_SCHEMA, OPENAI_SYSTEM_PROMPT, OpenAIMenuExtractionProvider, toStrictSchema, withoutNulls } from "./OpenAIMenuExtractionProvider.js";
import { MenuExtractionError } from "./MenuExtractionProvider.js";
import { SYSTEM_PROMPT } from "./ClaudeMenuExtractionProvider.js";

/**
 * Phase 89 — OpenAI Responses API adapter, with fetch stubbed: nothing here reaches OpenAI.
 * Request/response shapes follow OpenAI's official docs (see the adapter's header comment).
 */
const originalFetch = global.fetch;
let fetchMock: jest.Mock;

function respond(status: number, body: unknown, { invalidJson = false } = {}) {
  fetchMock = jest.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: invalidJson ? async () => Promise.reject(new SyntaxError("not json")) : async () => body,
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}

function completed(result: unknown, model = "gpt-4.1-2025-04-14") {
  return { model, status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(result) }] }] };
}

function sentBody(): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
}

const provider = new OpenAIMenuExtractionProvider("sk-test-secret-key", "gpt-4.1");
const pdfInput = { kind: "pdf" as const, buffer: Buffer.from("%PDF-1.7 fixture"), fileName: "menu.pdf" };

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("OpenAIMenuExtractionProvider — request", () => {
  it("posts to the Responses API with a Bearer key, the shared prompt, strict JSON schema, and no storage", async () => {
    respond(200, completed({ rows: [], warnings: [] }));
    await provider.extract(pdfInput);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test-secret-key");
    const body = sentBody();
    expect(body).toMatchObject({ model: "gpt-4.1", instructions: OPENAI_SYSTEM_PROMPT, store: false });
    expect(body.text).toEqual({ format: { type: "json_schema", name: "record_menu", schema: MENU_RESULT_STRICT_SCHEMA, strict: true } });
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(8192);
  });

  it("keeps Claude's extraction rules; only the tool-specific last sentence differs", () => {
    expect(OPENAI_SYSTEM_PROMPT).not.toBe(SYSTEM_PROMPT);
    expect(OPENAI_SYSTEM_PROMPT).toContain("never invent ingredients, dietary labels, prices, or descriptions");
    expect(OPENAI_SYSTEM_PROMPT).toContain("Always return your result in the required JSON format.");
    expect(OPENAI_SYSTEM_PROMPT).not.toContain("record_menu tool");
  });

  it("sends a PDF as one input_file with a base64 PDF data URL, then the instruction", async () => {
    respond(200, completed({ rows: [], warnings: [] }));
    await provider.extract(pdfInput);
    const content = (sentBody().input as Array<{ role: string; content: Array<Record<string, string>> }>)[0];
    expect(content.role).toBe("user");
    expect(content.content[0]).toEqual({ type: "input_file", filename: "menu.pdf", file_data: `data:application/pdf;base64,${pdfInput.buffer.toString("base64")}` });
    expect(content.content[1]).toMatchObject({ type: "input_text" });
    expect(content.content[1].text).toMatch(/preserving page order/);
  });

  it("sends images as input_image data URLs in upload order, each with its own type, then the instruction", async () => {
    respond(200, completed({ rows: [], warnings: [] }));
    await provider.extract({
      kind: "images",
      buffers: [Buffer.from("first"), Buffer.from("second"), Buffer.from("third")],
      fileNames: ["1.jpg", "2.png", "3.webp"],
      mimeTypes: ["image/jpeg", "image/png", "image/webp"],
    });
    const parts = (sentBody().input as Array<{ content: Array<Record<string, string>> }>)[0].content;
    expect(parts.map((p) => p.type)).toEqual(["input_image", "input_image", "input_image", "input_text"]);
    expect(parts[0].image_url).toBe(`data:image/jpeg;base64,${Buffer.from("first").toString("base64")}`);
    expect(parts[1].image_url).toBe(`data:image/png;base64,${Buffer.from("second").toString("base64")}`);
    expect(parts[2].image_url).toBe(`data:image/webp;base64,${Buffer.from("third").toString("base64")}`);
    expect(parts[3].text).toMatch(/These 3 images .* IN ORDER .* sourcePageIndex/);
  });

  it("sends a web page as text with its source URL", async () => {
    respond(200, completed({ rows: [], warnings: [] }));
    await provider.extract({ kind: "html", html: "<h1>Menu</h1><p>Soup 5.00</p>", sourceUrl: "https://example.test/menu" });
    const parts = (sentBody().input as Array<{ content: Array<Record<string, string>> }>)[0].content;
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("input_text");
    expect(parts[0].text).toContain("source: https://example.test/menu");
    expect(parts[0].text).toContain("<h1>Menu</h1><p>Soup 5.00</p>");
  });
});

describe("OpenAIMenuExtractionProvider — strict schema", () => {
  it("lists every property as required and forbids extra keys on every object", () => {
    const check = (schema: Record<string, unknown>) => {
      const target = (schema.anyOf as Array<Record<string, unknown>> | undefined)?.[0] ?? schema;
      if (target.type === "object" || (Array.isArray(target.type) && target.type.includes("object"))) {
        expect(target.additionalProperties).toBe(false);
        expect(new Set(target.required as string[])).toEqual(new Set(Object.keys(target.properties as object)));
        Object.values(target.properties as Record<string, Record<string, unknown>>).forEach(check);
      }
      if (target.items) check(target.items as Record<string, unknown>);
    };
    check(MENU_RESULT_STRICT_SCHEMA);
  });

  it("keeps the shared menu fields, making only the originally-optional ones nullable", () => {
    const row = ((MENU_RESULT_STRICT_SCHEMA.properties as Record<string, Record<string, unknown>>).rows.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(row).sort()).toEqual(
      ["categoryName", "description", "fieldConfidence", "imageUrl", "isAvailable", "itemName", "modifierGroups", "overallConfidence", "price", "sourcePageIndex"].sort()
    );
    expect(row.categoryName.type).toBe("string");
    expect(row.overallConfidence.type).toBe("number");
    expect(row.price.type).toEqual(["string", "null"]);
    expect(row.price.description).toMatch(/exactly as shown/);
    expect(row.sourcePageIndex.type).toEqual(["integer", "null"]);
    expect(row.modifierGroups.anyOf).toEqual([expect.objectContaining({ type: "array" }), { type: "null" }]);
  });

  it("toStrictSchema leaves a schema's own required fields non-nullable", () => {
    const strict = toStrictSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"] });
    expect(strict).toEqual({
      type: "object",
      properties: { a: { type: "string" }, b: { type: ["string", "null"] } },
      required: ["a", "b"],
      additionalProperties: false,
    });
  });
});

describe("OpenAIMenuExtractionProvider — response mapping", () => {
  it("maps structured output into the same MenuExtractionResult, preserving every field and dropping nulls", async () => {
    respond(
      200,
      completed({
        rows: [
          {
            categoryName: "Pizza",
            itemName: "Margherita",
            description: null,
            price: "12.99",
            isAvailable: true,
            imageUrl: null,
            modifierGroups: [{ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Large", priceAdjustment: 3 }, { name: "Small", priceAdjustment: null }] }],
            overallConfidence: 0.92,
            fieldConfidence: [{ field: "price", score: 0.8 }],
            sourcePageIndex: 2,
          },
        ],
        warnings: ["Page 3 was blurry"],
      })
    );
    const result = await provider.extract(pdfInput);
    expect(result).toEqual({
      rows: [
        {
          categoryName: "Pizza",
          itemName: "Margherita",
          price: "12.99",
          isAvailable: true,
          modifierGroups: [{ name: "Size", minSelect: 1, maxSelect: 1, options: [{ name: "Large", priceAdjustment: 3 }, { name: "Small" }] }],
          overallConfidence: 0.92,
          fieldConfidence: [{ field: "price", score: 0.8 }],
          sourcePageIndex: 2,
        },
      ],
      warnings: ["Page 3 was blurry"],
      modelUsed: "gpt-4.1-2025-04-14",
    });
  });

  it("joins several output_text parts before parsing", async () => {
    const json = JSON.stringify({ rows: [{ categoryName: "A", itemName: "B", overallConfidence: 1, fieldConfidence: [] }], warnings: [] });
    respond(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: json.slice(0, 20) }, { type: "output_text", text: json.slice(20) }] }] });
    const result = await provider.extract(pdfInput);
    expect(result.rows).toHaveLength(1);
    expect(result.modelUsed).toBe("gpt-4.1");
  });

  it("withoutNulls removes null fields recursively but keeps arrays in order", () => {
    expect(withoutNulls({ a: null, b: [1, null, { c: null, d: 2 }], e: "x" })).toEqual({ b: [1, { d: 2 }], e: "x" });
  });
});

describe("OpenAIMenuExtractionProvider — failures", () => {
  const expectError = async (code: string, retryable: boolean, message?: RegExp) => {
    const error = (await provider.extract(pdfInput).catch((e: unknown) => e)) as MenuExtractionError;
    expect(error).toBeInstanceOf(MenuExtractionError);
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(retryable);
    if (message) expect(error.message).toMatch(message);
    expect(error.message).not.toContain("sk-test-secret-key");
    return error;
  };

  it("a refusal content part is reported as refused, not retried", async () => {
    respond(200, { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }] });
    await expectError("refused", false, /declined/);
  });

  it("output cut off at the token limit is reported as incomplete with what to do, not retried", async () => {
    respond(200, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] });
    await expectError("incomplete", false, /too long to read in one pass\. Split the PDF/);
  });

  it("a content-filter stop is reported as refused", async () => {
    respond(200, { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [] });
    await expectError("refused", false);
  });

  it("malformed JSON, missing rows, or no output at all are provider errors (retryable)", async () => {
    respond(200, { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "{not json" }] }] });
    await expectError("provider_error", true, /malformed/);
    respond(200, completed({ warnings: [] }));
    await expectError("provider_error", true, /missing menu rows/);
    respond(200, { status: "completed", output: [] });
    await expectError("provider_error", true, /did not return structured menu data/);
    respond(200, {}, { invalidJson: true });
    await expectError("provider_error", true, /unreadable response/);
  });

  it("a failed response: rate limit and server errors retry, anything else doesn't", async () => {
    respond(200, { status: "failed", error: { code: "rate_limit_exceeded", message: "slow down" } });
    await expectError("rate_limited", true);
    respond(200, { status: "failed", error: { code: "server_error", message: "boom" } });
    await expectError("provider_unavailable", true);
    respond(200, { status: "failed", error: { code: "invalid_prompt", message: "nope" } });
    await expectError("rejected", false, /invalid_prompt/);
  });

  it("401/403 are invalid credentials and never echo the provider's text", async () => {
    respond(401, { error: { message: "Incorrect API key provided: sk-test-****", code: "invalid_api_key" } });
    const error = await expectError("invalid_credentials", false);
    expect(error.message).toBe("The extraction service rejected these credentials.");
  });

  it("429 rate limits retry; 429 out-of-credit or spend-limit codes do not", async () => {
    respond(429, { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } });
    await expectError("rate_limited", true, /retry automatically/);
    respond(429, { error: { message: "You exceeded your current quota", code: "insufficient_quota" } });
    await expectError("quota_exceeded", false);
    respond(429, { error: { message: "No credits", code: "credit_balance_exhausted" } });
    await expectError("quota_exceeded", false);
  });

  it("other 4xx are rejected requests (not retried) showing only the provider's error message, trimmed", async () => {
    respond(400, { error: { message: "Invalid file data. ".repeat(40), type: "invalid_request_error" } });
    const error = await expectError("rejected", false, /^The extraction service rejected this request \(HTTP 400\): Invalid file data\./);
    expect(error.message.length).toBeLessThan(400);
  });

  it("5xx are temporary; a non-JSON error page is never echoed", async () => {
    respond(503, {}, { invalidJson: true });
    const error = await expectError("provider_unavailable", true);
    expect(error.message).toBe("The extraction service is temporarily unavailable (HTTP 503).");
  });

  it("a timeout and a network failure are both retryable", async () => {
    global.fetch = jest.fn().mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" })) as unknown as typeof fetch;
    await expectError("timeout", true, /timed out/);
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("ECONNRESET")) as unknown as typeof fetch;
    await expectError("provider_unavailable", true);
  });
});
