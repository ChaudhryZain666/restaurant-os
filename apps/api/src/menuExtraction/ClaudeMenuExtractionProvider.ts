import { MenuExtractionError, type MenuExtractionInput, type MenuExtractionProvider, type MenuExtractionResult, type ExtractedRow } from "./MenuExtractionProvider.js";
import { EXTRACTION_PROVIDER_TIMEOUT_MS } from "../services/menuImport/menuImportLimits.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Real menu-extraction adapter targeting Anthropic's Claude API (Messages API, native `document`/
 * `image` content-block input, structured output forced via tool-use) — hand-rolled `fetch`, no
 * `@anthropic-ai/sdk` dependency, matching this codebase's own established convention
 * (StripeProvider.ts/SafepayProvider.ts are both hand-rolled REST calls, neither SDK is a
 * dependency here).
 *
 * Researched against Anthropic's own published Messages API documentation (vision content blocks,
 * native PDF document input, forced tool-use for structured JSON output) as of the time this was
 * written — like every other real-but-unverified provider adapter in this codebase (Stripe,
 * Safepay, Uber Eats, DoorDash, foodpanda, Paddle), this has never been exercised against a live
 * account/API key, since none is available in this development environment. `MENU_EXTRACTION_
 * PROVIDER_MODE=mock` (the default) is what every dev/test environment actually runs on until a
 * deployment deliberately opts into `=live` with a real ANTHROPIC_API_KEY configured.
 *
 * VERIFIED (from Anthropic's own documented API shape):
 *  - Endpoint `POST https://api.anthropic.com/v1/messages`, auth via `x-api-key` header (not
 *    Bearer), `anthropic-version` header required, JSON request/response.
 *  - `content` blocks support `type:"document"` (`source:{type:"base64", media_type:"application/
 *    pdf", data}`) and `type:"image"` (`source:{type:"base64", media_type, data}`) alongside plain
 *    `type:"text"` — multiple content blocks in one message, read in array order.
 *  - Forcing a specific tool call via `tool_choice:{type:"tool", name:"..."}` is the documented
 *    mechanism for reliable structured output, more robust than asking for free-text JSON and
 *    parsing it.
 *
 * NOT independently verified against a live response (a reasonable, documented inference — never
 * invented — but not confirmed against real API traffic): the exact token/latency behavior of a
 * multi-page PDF or multi-image request, and whether the model's actual extraction quality matches
 * what the tool schema below asks for — both require a real account to confirm.
 */
export class ClaudeMenuExtractionProvider implements MenuExtractionProvider {
  readonly name = "claude";

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async extract(input: MenuExtractionInput): Promise<MenuExtractionResult> {
    const content = this.buildContentBlocks(input);
    const body = {
      model: this.model,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
      tools: [RECORD_MENU_TOOL],
      tool_choice: { type: "tool", name: "record_menu" },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACTION_PROVIDER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new MenuExtractionError("The menu-reading request timed out.", "timeout");
      }
      throw new MenuExtractionError(`Could not reach the extraction service: ${(err as Error).message}`, "provider_unavailable");
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new MenuExtractionError("The extraction service rejected these credentials.", "invalid_credentials");
      }
      const text = await res.text().catch(() => "");
      throw new MenuExtractionError(`Extraction service error (HTTP ${res.status}): ${text.slice(0, 300)}`, "provider_error");
    }

    let json: AnthropicMessageResponse;
    try {
      json = (await res.json()) as AnthropicMessageResponse;
    } catch {
      throw new MenuExtractionError("The extraction service returned an unreadable response.", "provider_error");
    }

    const toolUse = json.content?.find((block) => block.type === "tool_use" && block.name === "record_menu");
    if (!toolUse) {
      throw new MenuExtractionError("The extraction service did not return structured menu data.", "provider_error");
    }

    return this.parseToolInput(toolUse.input, json.model);
  }

  private buildContentBlocks(input: MenuExtractionInput): AnthropicContentBlock[] {
    if (input.kind === "pdf") {
      return [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.buffer.toString("base64") } },
        { type: "text", text: `Extract every menu item from this PDF ("${input.fileName}"), preserving page order.` },
      ];
    }
    if (input.kind === "images") {
      const blocks: AnthropicContentBlock[] = input.buffers.map((buf, i) => ({
        type: "image",
        source: { type: "base64", media_type: input.mimeTypes[i], data: buf.toString("base64") },
      }));
      blocks.push({
        type: "text",
        text: `These ${input.buffers.length} images are pages/photos of one restaurant menu, IN ORDER (image 1 = page/photo 1, etc.). Extract every menu item, setting sourcePageIndex to the 1-based image number each item came from.`,
      });
      return blocks;
    }
    return [
      {
        type: "text",
        text: `Extract every menu item from this restaurant menu web page (source: ${input.sourceUrl}). Ignore navigation, ads, and unrelated page content. HTML:\n\n${input.html}`,
      },
    ];
  }

  private parseToolInput(input: unknown, model: string): MenuExtractionResult {
    const parsed = input as { rows?: unknown; warnings?: unknown };
    if (!Array.isArray(parsed.rows)) {
      throw new MenuExtractionError("The extraction service's response was missing menu rows.", "provider_error");
    }
    const rows: ExtractedRow[] = parsed.rows.map((r) => r as ExtractedRow);
    const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.filter((w): w is string => typeof w === "string") : [];
    return { rows, warnings, modelUsed: model };
  }
}

const SYSTEM_PROMPT = `You extract restaurant menu data from a source document, image set, or web page.
Report exactly what is present — never invent ingredients, dietary labels, prices, or descriptions
that are not explicitly shown. If a field is illegible or absent, omit it rather than guessing, and
give that row a low confidence score. Always call the record_menu tool with your result.`;

const RECORD_MENU_TOOL = {
  name: "record_menu",
  description: "Records the menu items extracted from the provided source.",
  input_schema: {
    type: "object",
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            categoryName: { type: "string" },
            itemName: { type: "string" },
            description: { type: "string" },
            price: { type: "string", description: "The price exactly as shown, e.g. \"12.99\" — do not compute or guess one." },
            isAvailable: { type: "boolean" },
            imageUrl: { type: "string" },
            modifierGroups: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  minSelect: { type: "integer" },
                  maxSelect: { type: "integer" },
                  options: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: { name: { type: "string" }, priceAdjustment: { type: "number" } },
                      required: ["name"],
                    },
                  },
                },
                required: ["name", "options"],
              },
            },
            overallConfidence: { type: "number", description: "0 to 1 — how confident you are this row is fully correct." },
            fieldConfidence: {
              type: "array",
              items: {
                type: "object",
                properties: { field: { type: "string" }, score: { type: "number" } },
                required: ["field", "score"],
              },
            },
            sourcePageIndex: { type: "integer", description: "1-based page or image number this row came from, if applicable." },
          },
          required: ["categoryName", "itemName", "overallConfidence", "fieldConfidence"],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["rows", "warnings"],
  },
} as const;

interface AnthropicContentBlock {
  type: "document" | "image" | "text";
  source?: { type: "base64"; media_type: string; data: string };
  text?: string;
}

interface AnthropicContentResponseBlock {
  type: string;
  name?: string;
  input?: unknown;
}

interface AnthropicMessageResponse {
  model: string;
  content: AnthropicContentResponseBlock[];
}
