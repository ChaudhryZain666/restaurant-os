import {
  MenuExtractionError,
  type ExtractedRow,
  type MenuExtractionInput,
  type MenuExtractionProvider,
  type MenuExtractionResult,
} from "./MenuExtractionProvider.js";
import { RECORD_MENU_TOOL, SYSTEM_PROMPT } from "./ClaudeMenuExtractionProvider.js";
import { EXTRACTION_PROVIDER_TIMEOUT_MS } from "../services/menuImport/menuImportLimits.js";

const API_URL = "https://api.openai.com/v1/responses";
// Covers reasoning tokens too on reasoning models (Responses API: max_output_tokens includes them),
// hence higher than the Claude adapter's 8192. A menu that still doesn't fit is reported as
// "incomplete", never returned as a silently shortened menu.
const MAX_OUTPUT_TOKENS = 16_384;
const PROVIDER_MESSAGE_MAX_CHARS = 300;
/** HTTP 429 codes that mean the account can't spend more — retrying won't help. */
const QUOTA_ERROR_CODES = new Set(["insufficient_quota", "credit_balance_exhausted", "organization_spend_limit_exceeded", "billing_hard_limit_reached"]);

/**
 * Phase 89 — menu extraction through OpenAI's Responses API, the same job as
 * ClaudeMenuExtractionProvider: same prompt, same menu fields, same MenuExtractionResult, so the
 * import pipeline, review UI and database don't know which provider ran. Hand-rolled `fetch`, no SDK,
 * matching the Claude adapter and the rest of this codebase's provider adapters.
 *
 * Request shape checked against OpenAI's official docs (developers.openai.com, 2026-10-11):
 *  - POST https://api.openai.com/v1/responses, `Authorization: Bearer <key>`; `instructions` carries
 *    the system prompt; `input` is one user message whose `content` parts are read in order.
 *  - PDF: `{type:"input_file", filename, file_data:"data:application/pdf;base64,…"}` — on
 *    vision-capable models ("gpt-4o and later") the API sends both the extracted text and an image
 *    of each page. 50 MB per request.
 *  - Image: `{type:"input_image", image_url:"data:<mime>;base64,…"}` (PNG/JPEG/WEBP accepted).
 *  - Structured output: `text.format = {type:"json_schema", name, schema, strict:true}`. Strict mode
 *    requires every property to be listed in `required` and `additionalProperties:false` on every
 *    object; optional fields are emulated with a union with null (toStrictSchema below).
 *  - Outcomes: `status` completed | failed | incomplete …, `incomplete_details.reason`
 *    (max_output_tokens | content_filter …), refusals as a `refusal` content part, the answer as
 *    `output_text` parts.
 * Never run against the live API in this environment (no key; live calls not approved): the
 * stubbed-fetch tests in OpenAIMenuExtractionProvider.test.ts are the only verification so far.
 */
export class OpenAIMenuExtractionProvider implements MenuExtractionProvider {
  readonly name = "openai";

  constructor(
    private readonly apiKey: string,
    private readonly model: string
  ) {}

  async extract(input: MenuExtractionInput): Promise<MenuExtractionResult> {
    const body = {
      model: this.model,
      instructions: OPENAI_SYSTEM_PROMPT,
      input: [{ role: "user", content: buildContent(input) }],
      text: { format: { type: "json_schema", name: "record_menu", schema: MENU_RESULT_STRICT_SCHEMA, strict: true } },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      // The menu belongs to the restaurant; nothing needs to be kept on OpenAI's side afterwards.
      store: false,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), EXTRACTION_PROVIDER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
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

    if (!res.ok) throw await httpError(res);

    let json: OpenAIResponse;
    try {
      json = (await res.json()) as OpenAIResponse;
    } catch {
      throw new MenuExtractionError("The extraction service returned an unreadable response.", "provider_error");
    }
    return parseResponse(json, this.model);
  }
}

/** Same rules as the Claude prompt; only the final, tool-specific sentence differs. */
export const OPENAI_SYSTEM_PROMPT = SYSTEM_PROMPT.replace(
  "Always call the record_menu tool with your result.",
  "Always return your result in the required JSON format."
);

function buildContent(input: MenuExtractionInput): OpenAIInputPart[] {
  if (input.kind === "pdf") {
    return [
      { type: "input_file", filename: input.fileName, file_data: `data:application/pdf;base64,${input.buffer.toString("base64")}` },
      { type: "input_text", text: `Extract every menu item from this PDF ("${input.fileName}"), preserving page order.` },
    ];
  }
  if (input.kind === "images") {
    const parts: OpenAIInputPart[] = input.buffers.map((buf, i) => ({
      type: "input_image",
      image_url: `data:${input.mimeTypes[i]};base64,${buf.toString("base64")}`,
    }));
    parts.push({
      type: "input_text",
      text: `These ${input.buffers.length} images are pages/photos of one restaurant menu, IN ORDER (image 1 = page/photo 1, etc.). Extract every menu item, setting sourcePageIndex to the 1-based image number each item came from.`,
    });
    return parts;
  }
  return [
    {
      type: "input_text",
      text: `Extract every menu item from this restaurant menu web page (source: ${input.sourceUrl}). Ignore navigation, ads, and unrelated page content. HTML:\n\n${input.html}`,
    },
  ];
}

async function httpError(res: Response): Promise<MenuExtractionError> {
  let providerMessage: string | undefined;
  let providerCode: string | undefined;
  try {
    const body = (await res.json()) as { error?: { message?: unknown; code?: unknown } };
    if (typeof body?.error?.message === "string") providerMessage = body.error.message.slice(0, PROVIDER_MESSAGE_MAX_CHARS);
    if (typeof body?.error?.code === "string") providerCode = body.error.code;
  } catch {
    // Non-JSON body (gateway/CDN page) — never echoed; the generic message below is used instead.
  }
  const detail = providerMessage ? `: ${providerMessage}` : "";

  if (res.status === 401 || res.status === 403) {
    return new MenuExtractionError("The extraction service rejected these credentials.", "invalid_credentials");
  }
  if (res.status === 429) {
    if (providerCode && QUOTA_ERROR_CODES.has(providerCode)) {
      return new MenuExtractionError("The extraction service account has no remaining credit or has reached its spending limit.", "quota_exceeded");
    }
    return new MenuExtractionError("The extraction service is busy right now (rate limit). The import will retry automatically.", "rate_limited");
  }
  if (res.status >= 500) {
    return new MenuExtractionError(`The extraction service is temporarily unavailable (HTTP ${res.status}).`, "provider_unavailable");
  }
  if (res.status >= 400) {
    return new MenuExtractionError(`The extraction service rejected this request (HTTP ${res.status})${detail}`, "rejected");
  }
  return new MenuExtractionError(`Extraction service error (HTTP ${res.status})${detail}`, "provider_error");
}

function parseResponse(json: OpenAIResponse, requestedModel: string): MenuExtractionResult {
  if (json.status === "incomplete") {
    if (json.incomplete_details?.reason === "content_filter") {
      throw new MenuExtractionError("The extraction service declined to read this menu.", "refused");
    }
    throw new MenuExtractionError(
      json.incomplete_details?.reason === "max_output_tokens"
        ? "This menu is too long to read in one pass. Split the PDF or upload fewer photos per import."
        : "The extraction service stopped before finishing this menu.",
      "incomplete"
    );
  }
  if (json.status === "failed") {
    const code = json.error?.code;
    if (code === "rate_limit_exceeded") {
      throw new MenuExtractionError("The extraction service is busy right now (rate limit). The import will retry automatically.", "rate_limited");
    }
    if (code === "server_error") throw new MenuExtractionError("The extraction service failed temporarily.", "provider_unavailable");
    throw new MenuExtractionError(`The extraction service could not process this menu${code ? ` (${code})` : ""}.`, "rejected");
  }
  if (json.status && json.status !== "completed") {
    throw new MenuExtractionError("The extraction service did not finish this menu.", "provider_error");
  }

  const parts = (json.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === "refusal")) {
    throw new MenuExtractionError("The extraction service declined to read this menu.", "refused");
  }
  const text = parts
    .filter((part) => part.type === "output_text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("");
  if (!text) throw new MenuExtractionError("The extraction service did not return structured menu data.", "provider_error");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new MenuExtractionError("The extraction service returned malformed menu data.", "provider_error");
  }
  const result = withoutNulls(parsed) as { rows?: unknown; warnings?: unknown };
  if (!result || typeof result !== "object" || !Array.isArray(result.rows)) {
    throw new MenuExtractionError("The extraction service's response was missing menu rows.", "provider_error");
  }
  const rows = result.rows.filter((r): r is ExtractedRow => !!r && typeof r === "object");
  const warnings = Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === "string") : [];
  return { rows, warnings, modelUsed: typeof json.model === "string" ? json.model : requestedModel };
}

/** Strict mode answers "not present" with null; the rest of the pipeline expects the field to be
 *  absent (same as the Claude adapter's output), so nulls are dropped — arrays keep their order. */
export function withoutNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(withoutNulls);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) if (v !== null) out[key] = withoutNulls(v);
    return out;
  }
  return value;
}

type JsonSchema = Record<string, unknown>;

/**
 * The shared menu schema (RECORD_MENU_TOOL.input_schema) in OpenAI strict form: every object lists
 * all its properties as required and sets additionalProperties:false; a property that was optional
 * becomes nullable (a type union with null for scalars, anyOf with null for arrays/objects). Field
 * names, types and descriptions are unchanged.
 */
export function toStrictSchema(schema: JsonSchema): JsonSchema {
  if (schema.type === "object" && schema.properties && typeof schema.properties === "object") {
    const originallyRequired = new Set((schema.required as string[] | undefined) ?? []);
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(schema.properties as Record<string, JsonSchema>)) {
      const strictChild = toStrictSchema(child);
      properties[key] = originallyRequired.has(key) ? strictChild : nullable(strictChild);
    }
    return { ...schema, properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema.type === "array" && schema.items) {
    return { ...schema, items: toStrictSchema(schema.items as JsonSchema) };
  }
  return { ...schema };
}

function nullable(schema: JsonSchema): JsonSchema {
  if (schema.type === "object" || schema.type === "array") return { anyOf: [schema, { type: "null" }] };
  if (typeof schema.type === "string") return { ...schema, type: [schema.type, "null"] };
  return schema;
}

export const MENU_RESULT_STRICT_SCHEMA = toStrictSchema(RECORD_MENU_TOOL.input_schema as unknown as JsonSchema);

type OpenAIInputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };

interface OpenAIResponse {
  model?: string;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { code?: string; message?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}
